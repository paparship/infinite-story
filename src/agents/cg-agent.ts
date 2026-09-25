/**
 * CG 生成 Agent
 * 
 * 完整流程：
 * 1. 读取 settings 文件（剧情场景 + 角色描述）
 * 2. LLM 转换为 NanoBanana/Danbooru 标签格式
 * 3. 调用图像生成 API (Midjourney/Flux/SD)
 * 4. 保存生成的 CG 图像
 * 
 * @see prompts/image/nanobanana_cg.txt 查看提示词模板说明
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatVertexAI } from "@langchain/google-vertexai";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { compilePrompt } from "./services/prompt-compiler.js";
import { PROMPT_CONTRACT_VERSION } from "./services/prompt-contract.js";
import {
  buildMidjourneyPrompt,
  truncateMidjourneyPromptPreserveParams,
  buildGemini3Prompt,
} from "./services/image-prompt-renderer.js";

// ESM 兼容
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载配置
const API_CONFIG_PATH = path.join(__dirname, "config/api-config.json");
const API_CONFIG = fs.existsSync(API_CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(API_CONFIG_PATH, "utf-8"))
  : null;

// ============================================
// 目录配置
// ============================================

const ASSETS_DIR = path.resolve(__dirname, "../../assets");
const STORY_DIR = path.join(ASSETS_DIR, "story");
const DEFAULT_CG_DIR = path.join(ASSETS_DIR, "cg");

function getCgPromptContractId(): string {
  if ((process.env.PROMPT_BRANCH || "").toLowerCase() === "v2") {
    return "image_v2/nanobanana_cg";
  }
  return "image/nanobanana_cg";
}

// 注意：不再使用全局变量，避免并行冲突
// outputDir 通过 state 传递给每个节点

// 确保目录存在
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createRandomSeed(): string {
  return `${Math.floor(Math.random() * 4294967295)}`;
}

function appendSeedNote(prompt: string, seed: string): string {
  return `${prompt}\n\n[RandomSeed] ${seed}\n请使用该随机种子增加随机性，但保持格式要求。`;
}

function fileSha256(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function isValidHttpUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ============================================
// 类型定义
// ============================================

/** CG 来源章节 */
type CGSource = 
  | "chapter1"
  | "chapter2_route_a"
  | "chapter2_route_b"
  | "chapter2_route_c"
  | "chapter3_route_a"
  | "chapter3_route_b"
  | "chapter3_route_c";

/** CG 输入数据 */
interface CGInput {
  source: CGSource;
  settingsFile: string;
  sceneDescription: string;
  characterDescription: string;
  cgName?: string; // 从脚本中提取的 @cg 名称
  cgTitle?: string; // 从脚本中提取的诗意标题
  characterSpritePath?: string; // 角色立绘本地路径（用于 Image Prompt）
}

/** 生成的 CG */
interface GeneratedCG {
  source: CGSource;
  cgName: string;
  cgTitle?: string;
  positivePrompt: string;
  negativePrompt: string;
  analysis: string;
  imageUrl?: string;
  localPath?: string;
}

/** 流水线阶段 */
type PipelineStage =
  | "init"
  | "parse_settings"    // 解析 settings 文件
  | "generate_prompt"   // LLM 生成提示词
  | "generate_image"    // 调用图像 API
  | "save_output"       // 保存结果
  | "completed"
  | "failed";

// ============================================
// 状态定义
// ============================================

const CGStateAnnotation = Annotation.Root({
  cgInput: Annotation<CGInput>,
  currentStage: Annotation<PipelineStage>,
  // 输出目录（避免并行冲突，每个任务独立）
  outputDir: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => DEFAULT_CG_DIR,
  }),
  randomSeed: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  generatedPrompt: Annotation<{
    positive: string;
    negative: string;
    analysis: string;
  } | null>,
  llmRenderedPrompt: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  mjFinalPrompt: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  geminiFinalPrompt: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),
  characterReferenceUrl: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),
  generatedCG: Annotation<GeneratedCG | null>,
  error: Annotation<string | null>,
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => [...curr, ...update],
    default: () => [],
  }),
});

type CGStateType = typeof CGStateAnnotation.State;

// ============================================
// 配置
// ============================================

// 凭据路径（在项目根目录的 credentials 文件夹）
const CREDENTIALS_PATH = path.resolve(__dirname, "../../../../credentials/vertex_service_account.json");

// 设置 Google 凭据（必须在创建 LLM 实例之前）
if (fs.existsSync(CREDENTIALS_PATH)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDENTIALS_PATH;
}

const CONFIG = {
  // LLM 配置（用于提示词转换）
  llm: {
    model: "gemini-2.5-flash",
    project: API_CONFIG?.["vertex-chat"]?.api_key || "REDACTED_CONFIGURE_LOCALLY",
    location: "global",
    credentialsPath: CREDENTIALS_PATH,
  },
  // 图像生成配置
  imageGen: {
    provider: "gemini-3-pro-image" as "midjourney" | "flux" | "sd" | "gemini-3-pro-image",
    geminiModel: "gemini-3-pro-image-preview",
    mjApiKey: API_CONFIG?.["midjourney-image"]?.api_key || "",
    mjBaseUrl: API_CONFIG?.["midjourney-image"]?.base_url || "REDACTED_CONFIGURE_LOCALLY",
  },
  // 输出配置
  output: {
    format: "png",
    size: { width: 1920, height: 1080 }, // 16:9 CG (match screen)
  },
};

// ============================================
// 辅助函数
// ============================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析 settings 文件，提取场景和角色描述
 * 支持 v2 @ 指令格式: @scene / @character / @palette
 * 同时兼容旧格式: [场景] ... [角色] ... [配色] ...
 *
 * 注意：如果场景涉及拥抱等双人互动，会自动忽略拥抱，只保留普通场景背景
 */
function parseSettingsFile(content: string, targetTitle?: string): {
  sceneDescription: string;
  characterDescription: string;
  cgName?: string;
} {
  // 检测场景是否涉及拥抱等双人互动
  const isEmbraceScene = /拥抱|拥抱住|相互拥抱|两人拥抱|紧紧拥抱|hug|embrace/i.test(content);

  const extractAtBlock = (tag: "scene" | "character" | "palette"): string => {
    const block = content.match(new RegExp(`(?:^|\\n)\\s*@${tag}\\b\\s*([\\s\\S]*?)(?=\\n\\s*@\\w+\\b|$)`, "i"));
    if (!block) return "";
    return block[1].replace(/^[：:\-=\s]+/, "").trim();
  };

  // v2 @ 指令格式（优先）
  const atScene = extractAtBlock("scene");
  const atCharacter = extractAtBlock("character");
  const atPalette = extractAtBlock("palette");

  // 旧格式（保留兼容）
  const sceneMatch = content.match(/\[场景\]\s*([\s\S]*?)(?=\[角色\]|$)/i);
  const charMatch = content.match(/\[角色\]\s*([\s\S]*?)(?=\[配色\]|$)/i);
  const colorMatch = content.match(/\[配色\]\s*([\s\S]*?)$/i);

  let sceneDescription = atScene || (sceneMatch ? sceneMatch[1].trim() : "");
  let characterDescription = atCharacter || (charMatch ? charMatch[1].trim() : "");
  const paletteDescription = atPalette || (colorMatch ? colorMatch[1].trim() : "");
  if (paletteDescription) {
    characterDescription += (characterDescription ? "\n" : "") + paletteDescription;
  }

  // 如果是拥抱场景，移除拥抱相关的描述，保留普通场景背景
  if (isEmbraceScene && sceneDescription) {
    sceneDescription = sceneDescription
      // 移除拥抱相关描述
      .replace(/拥抱[^，,。\n]*/g, "")
      .replace(/相互[^\n]*/g, "")
      .replace(/两人[^\n]*/g, "")
      .replace(/紧紧[^\n]*/g, "")
      .replace(/hug[^\n,.]*/gi, "")
      .replace(/embrace[^\n,.]*/gi, "")
      // 清理多余的标点和空格
      .replace(/[，,]+/g, ", ")
      .replace(/\s+/g, " ")
      .replace(/^[\s,]+|[\s,]+$/g, "")
      .trim();

    // 如果清理后场景描述为空，添加一个通用背景描述
    if (!sceneDescription) {
      sceneDescription = "school rooftop at sunset, warm lighting, atmospheric background";
    }
  }

  // 兼容旧格式
  if (!sceneDescription) {
    const oldSceneMatch = content.match(/场景[^：:]*[：:]([\s\S]*?)(?=角色|人物|$)/i);
    sceneDescription = oldSceneMatch ? oldSceneMatch[1].trim() : content;
  }
  if (!characterDescription) {
    const oldCharMatch = content.match(/(?:角色|人物)[^：:]*[：:]([\s\S]*?)(?=配色|$)/i);
    characterDescription = oldCharMatch ? oldCharMatch[1].trim() : "";
  }
  
  // 提取 CG 名称
  const cgNameMatch = content.match(/@cg\s+(cg_ch\d+[_a-c]*)/i);
  const cgName = cgNameMatch ? cgNameMatch[1] : undefined;
  
  return {
    sceneDescription: sceneDescription || content,
    characterDescription,
    cgName,
  };
}

/**
 * 构建 LLM 提示词
 */
/**
 * 清理提示词文本
 */
function cleanPromptText(text: string): string {
  return text
    // 移除 markdown 格式
    .replace(/^\*\*\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*```[\s\S]*?```\s*/g, "")
    // 移除中文标点和多余空白
    .replace(/，/g, ",")
    .replace(/：/g, ":")
    .replace(/\n/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    // 移除开头结尾的逗号和空格
    .replace(/^[\s,]+/, "")
    .replace(/[\s,]+$/, "")
    .trim();
}

/**
 * 解析 LLM 输出，提取 positive/negative prompt
 */
function parseLLMOutput(output: string): {
  positive: string;
  negative: string;
  analysis: string;
} {
  const atAnalysisMatch = output.match(/(?:^|\n)\s*@analysis\b\s*([\s\S]*?)(?=\n\s*@positive\b|$)/i);
  const atPositiveMatch = output.match(/(?:^|\n)\s*@positive\b\s*([\s\S]*?)(?=\n\s*@negative\b|$)/i);
  const atNegativeMatch = output.match(/(?:^|\n)\s*@negative\b\s*([\s\S]*?)$/i);

  if (atPositiveMatch) {
    const analysis = atAnalysisMatch ? atAnalysisMatch[1].trim() : "";
    const positive = cleanPromptText(atPositiveMatch[1].trim());
    let negative = atNegativeMatch ? cleanPromptText(atNegativeMatch[1].trim()) : "";
    if (!negative) {
      negative = "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet, extra limbs, extra legs, extra arms, missing limbs, fused limbs, mutated hands, poorly drawn hands, malformed hands, bad proportions, gross proportions, deformed, mutation, disfigured";
    }
    return { positive, negative, analysis };
  }

  // 提取画面设计分析
  const analysisMatch = output.match(/【画面设计分析】([\s\S]*?)(?=【Positive|$)/i);
  const analysis = analysisMatch ? analysisMatch[1].trim() : "";
  
  // 提取 Positive Prompt
  const positiveMatch = output.match(/【Positive Prompt】\s*([\s\S]*?)(?=【Negative|$)/i);
  let positive = positiveMatch ? positiveMatch[1].trim() : "";
  positive = cleanPromptText(positive);
  
  // 提取 Negative Prompt
  const negativeMatch = output.match(/【Negative Prompt】\s*([\s\S]*?)(?=---|$)/i);
  let negative = negativeMatch ? negativeMatch[1].trim() : "";
  negative = cleanPromptText(negative);
  
  // 默认 negative prompt
  if (!negative) {
    negative = "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet, extra limbs, extra legs, extra arms, missing limbs, fused limbs, mutated hands, poorly drawn hands, malformed hands, bad proportions, gross proportions, deformed, mutation, disfigured";
  }
  
  return { positive, negative, analysis };
}

// ============================================
// 图片上传到 imgbb
// ============================================

/**
 * 上传图片到 imgbb 获取公开 URL
 * 用于 Midjourney Image Prompt
 */
async function uploadToImgbb(imagePath: string): Promise<string | null> {
  const imgbbConfig = API_CONFIG?.["imgbb"];
  if (!imgbbConfig?.api_key) {
    console.log("   ⚠️ imgbb API 未配置，跳过角色参考图上传");
    return null;
  }
  
  if (!fs.existsSync(imagePath)) {
    console.log(`   ⚠️ 角色立绘不存在: ${imagePath}`);
    return null;
  }
  
  console.log(`   📤 上传角色立绘到 imgbb...`);
  
  try {
    const imageBase64 = fs.readFileSync(imagePath).toString("base64");
    
    const formData = new FormData();
    formData.append("key", imgbbConfig.api_key);
    formData.append("image", imageBase64);
    
    const response = await axios.post(
      imgbbConfig.base_url || "REDACTED_CONFIGURE_LOCALLY",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      }
    );
    
    if (response.data.success) {
      const url = response.data.data.url;
      console.log(`   ✅ 上传成功: ${url}`);
      return url;
    } else {
      console.log(`   ⚠️ 上传失败: ${JSON.stringify(response.data)}`);
      return null;
    }
  } catch (error) {
    console.log(`   ⚠️ imgbb 上传错误: ${error}`);
    return null;
  }
}

// ============================================
// Midjourney API 调用
// ============================================

/**
 * 解析 xiaochuanai API Key
 */
function parseApiKey(apiKey: string): { x_app: string; x_secret: string } {
  const parts = apiKey.split("|");
  return {
    x_app: parts[0] || "",
    x_secret: parts[1] || "",
  };
}

interface MJDiffusionResponse {
  code: number;
  message: string;
  taskId?: string;
  task_id?: string;
  id?: string;
  status?: string;
  images?: string[];
  image_url?: string;
  result?: {
    images?: string[];
    image_url?: string;
  };
}

async function mjGenerate(prompt: string): Promise<string> {
  const apiKey = CONFIG.imageGen.mjApiKey;
  const baseUrl = CONFIG.imageGen.mjBaseUrl;
  
  if (!apiKey) {
    throw new Error("Midjourney API Key 未配置");
  }
  
  const { x_app, x_secret } = parseApiKey(apiKey);
  
  // 截断过长的提示词（MJ 有字符限制）
  // 重要：只截断内容部分，保留 --ar 等 MJ 参数
  const maxPromptLength = 800;
  let finalPrompt = prompt;
  
  if (prompt.length > maxPromptLength) {
    finalPrompt = truncateMidjourneyPromptPreserveParams(prompt, maxPromptLength);
    console.log(`   ⚠️ 内容过长，已截断至 ${finalPrompt.length} 字符（保留 MJ 参数）`);
  }
  
  console.log("   📤 提交 MJ 生成任务...");
  console.log(`   Prompt: ${finalPrompt.substring(0, 100)}...`);
  
  // 使用正确的 xiaochuanai API 格式
  const headers = {
    "Content-Type": "application/json",
    "x-youchuan-app": x_app,
    "x-youchuan-secret": x_secret,
  };
  
  try {
    // 1. 提交生成任务
    const response = await axios.post(
      `${baseUrl}/tob/diffusion`,
      { text: finalPrompt },
      { headers, timeout: 60000 }
    );
    
    const jobId = response.data.id;
    if (!jobId) {
      console.log("   响应:", JSON.stringify(response.data, null, 2));
      throw new Error("MJ 未返回任务 ID");
    }
    
    console.log(`   ✅ 任务已提交, Job ID: ${jobId}`);
    
    // 2. 轮询获取结果 - 使用 /tob/job/{id} 端点
    console.log("   ⏳ 轮询任务状态 (间隔 10 秒)...");
    let pollCount = 0;
    const maxPolls = 60;
    
    while (pollCount < maxPolls) {
      pollCount++;
      await delay(10000);
      
      try {
        const pollResponse = await axios.get(
          `${baseUrl}/tob/job/${jobId}`,
          { headers, timeout: 30000 }
        );
        
        const comment = pollResponse.data.comment || "";
        const timestamp = new Date().toLocaleTimeString();
        console.log(`   [${timestamp}] 轮询 #${pollCount}: ${comment}`);
        
        if (comment === "完成" || comment === "成功") {
          const urls = pollResponse.data.urls || [];
          if (urls.length > 0) {
            console.log(`   ✅ 生成成功！MJ 返回 ${urls.length} 张变体`);
            console.log(`   📋 原始 URLs: ${JSON.stringify(urls)}`);
            const validUrls = urls.filter(isValidHttpUrl);
            if (validUrls.length === 0) {
              console.log(`   ❌ MJ 返回的 URLs 全部非法: ${JSON.stringify(urls)}`);
              throw new Error(`MJ 返回非法 URL 列表: ${JSON.stringify(urls)}`);
            }
            if (validUrls.length < urls.length) {
              console.log(`   ⚠️ 检测到非法 URL，已自动跳过 ${urls.length - validUrls.length} 项`);
            }
            console.log(`   📌 选择第 1 个合法 URL 作为 CG: ${validUrls[0]}`);
            return validUrls[0];
          }
          throw new Error("MJ 返回成功但无图像 URL");
        }
        
        if (comment === "失败" || comment.includes("error") || comment === "执行报错") {
          throw new Error(`MJ 生成失败: ${comment}`);
        }
        
      } catch (pollError: any) {
        if (pollError.response) {
          console.log(`   ⚠️ 轮询错误 (${pollError.response.status})`);
        } else if (!pollError.message?.includes("MJ")) {
          // 网络错误，继续轮询
          console.log(`   ⚠️ 轮询网络错误: ${pollError.message}`);
        } else {
          throw pollError;
        }
      }
    }
    
    throw new Error("MJ 生成超时");

  } catch (error: any) {
    if (error.response) {
      throw new Error(`MJ API 错误 (${error.response.status}): ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * 下载图片并转换为 base64 data URL
 */
async function downloadAsBase64(url: string): Promise<string> {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
  });

  const mimeType = response.headers["content-type"] || "image/png";
  const base64 = Buffer.from(response.data).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

/**
 * 使用 Gemini 3 Pro Image Preview 生成图像
 */
async function gemini3ImageGenerate(
  positivePrompt: string,
  negativePrompt: string,
  characterReferenceUrl?: string,
  seed?: string
): Promise<string> {
  console.log("   📤 调用 Gemini 3 Pro Image Preview...");

  // 构建 Gemini 3 格式的 prompt
  const promptText = buildGemini3Prompt({
    positivePrompt,
    negativePrompt,
    seed,
    characterReferenceUrl,
  });

  // 构建消息内容
  const messageContent: any[] = [
    { type: "text", text: promptText },
  ];

  // 如果有角色参考图，添加到消息中
  // Gemini 3 API 需要使用 base64 格式，直接传 URL 可能会有兼容性问题
  if (characterReferenceUrl) {
    let imageDataUrl: string;

    if (characterReferenceUrl.startsWith("data:")) {
      imageDataUrl = characterReferenceUrl;
    } else {
      // 下载图片并转换为 base64
      console.log("   📥 下载角色参考图...");
      imageDataUrl = await downloadAsBase64(characterReferenceUrl);
      console.log("   ✅ 参考图已转换为 base64");
    }

    messageContent.push({
      type: "image_url",
      image_url: { url: imageDataUrl },
    });
  }

  // 创建 Gemini 3 模型实例
  const model = new ChatVertexAI({
    model: CONFIG.imageGen.geminiModel,
    location: CONFIG.llm.location,
    temperature: 0.7,
  });

  // 调用 Gemini 3 Image API
  const response = await model.invoke([
    new HumanMessage({ content: messageContent }),
  ]);

  // 解析响应中的图像数据
  if (Array.isArray(response.content)) {
    for (const part of response.content) {
      if (typeof part === "object" && part !== null && "type" in part) {
        if ((part as any).type === "image_url") {
          const imageUrlData = (part as any).image_url;
          let imageData: string | undefined;

          if (typeof imageUrlData === "string") {
            imageData = imageUrlData;
          } else if (typeof imageUrlData === "object" && imageUrlData?.url) {
            imageData = imageUrlData.url;
          }

          if (imageData && imageData.startsWith("data:image")) {
            // 返回 base64 数据 URL
            console.log("   ✅ Gemini 3 Image 生成成功");
            return imageData;
          }
        }
      }
    }
  }

  throw new Error("Gemini 3 Image API 未返回图像数据");
}

/**
 * 下载图像并保存
 */
async function downloadImage(url: string, outputPath: string): Promise<void> {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  
  fs.writeFileSync(outputPath, Buffer.from(response.data));
}

// ============================================
// 流水线节点
// ============================================

/**
 * 初始化节点
 */
async function initNode(
  state: CGStateType
): Promise<Partial<CGStateType>> {
  console.log("\n🚀 [初始化] 准备 CG 生成流水线...");
  console.log(`   来源: ${state.cgInput.source}`);
  console.log(`   Settings 文件: ${state.cgInput.settingsFile}`);
  
  // 确保输出目录存在（使用 state.outputDir 避免并行冲突）
  ensureDir(state.outputDir);
  
  const randomSeed = state.randomSeed || createRandomSeed();
  
  return {
    currentStage: "parse_settings",
    randomSeed,
    messages: [new AIMessage("[初始化] CG 生成流水线已启动")],
  };
}

/**
 * 解析 settings 文件节点
 */
async function parseSettingsNode(
  state: CGStateType
): Promise<Partial<CGStateType>> {
  console.log("\n📖 [Step 1] 解析 settings 文件...");
  
  const settingsPath = state.cgInput.settingsFile;
  
  if (!fs.existsSync(settingsPath)) {
    return {
      currentStage: "failed",
      error: `Settings 文件不存在: ${settingsPath}`,
    };
  }
  
  const content = fs.readFileSync(settingsPath, "utf-8");
  const parsed = parseSettingsFile(content, state.cgInput.cgTitle);
  
  console.log(`   场景描述长度: ${parsed.sceneDescription.length} 字符`);
  console.log(`   角色描述长度: ${parsed.characterDescription.length} 字符`);
  if (parsed.cgName) {
    console.log(`   CG 名称: ${parsed.cgName}`);
  }
  
  // 更新输入数据
  const updatedInput: CGInput = {
    ...state.cgInput,
    sceneDescription: parsed.sceneDescription,
    characterDescription: parsed.characterDescription,
    cgName: parsed.cgName || state.cgInput.cgName,
  };
  
  return {
    cgInput: updatedInput,
    currentStage: "generate_prompt",
    messages: [new AIMessage("[解析] Settings 文件解析完成")],
  };
}

/**
 * LLM 生成提示词节点
 */
async function generatePromptNode(
  state: CGStateType
): Promise<Partial<CGStateType>> {
  console.log("\n🤖 [Step 2] LLM 转换为 NanoBanana 标签格式...");
  
  try {
    const cgContractId = getCgPromptContractId();
    const hasCharacterReference = Boolean(state.cgInput.characterSpritePath);
    const characterDescription = hasCharacterReference
      ? "角色外观以参考图为准，禁止描述发型、发色、五官、服装、配饰等外观信息。仅描述角色动作、姿态、表情与环境互动。"
      : state.cgInput.characterDescription;
    const prompt = appendSeedNote(
      compilePrompt(cgContractId, {
        SCENE_DESCRIPTION: state.cgInput.sceneDescription,
        CHARACTER_DESCRIPTION: characterDescription,
      }).renderedPrompt,
      state.randomSeed || createRandomSeed()
    );
    
    // 调用 LLM
    const llm = new ChatVertexAI({
      model: CONFIG.llm.model,
      location: CONFIG.llm.location,
      temperature: 0.7,
    });
    
    console.log("   🔄 调用 Gemini 生成提示词...");
    
    const response = await llm.invoke([
      new HumanMessage(prompt),
    ]);
    
    const output = response.content as string;
    const parsed = parseLLMOutput(output);
    
    console.log("\n   【画面设计分析】");
    console.log(`   ${parsed.analysis.substring(0, 200)}...`);
    console.log("\n   【Positive Prompt】");
    console.log(`   ${parsed.positive.substring(0, 150)}...`);
    
    return {
      generatedPrompt: parsed,
      llmRenderedPrompt: prompt,
      currentStage: "generate_image",
      messages: [new AIMessage("[提示词] NanoBanana 格式转换完成")],
    };
  } catch (error) {
    console.error(`   ❌ LLM 调用失败: ${error}`);
    return {
      currentStage: "failed",
      error: `LLM 调用失败: ${error}`,
    };
  }
}

/**
 * 图像生成节点
 */
async function generateImageNode(
  state: CGStateType
): Promise<Partial<CGStateType>> {
  console.log("\n🎨 [Step 3] 调用图像生成 API...");

  if (!state.generatedPrompt) {
    return {
      currentStage: "failed",
      error: "提示词未生成",
    };
  }

  try {
    const { positive: rawPositive, negative, analysis } = state.generatedPrompt;

    // 上传角色立绘获取公开 URL（用于 Image Prompt）
    let charRefUrl: string | null = null;
    if (state.cgInput.characterSpritePath) {
      charRefUrl = await uploadToImgbb(state.cgInput.characterSpritePath);
    }

    const seed = state.randomSeed || createRandomSeed();

    // 根据 provider 选择图像生成方式
    let imageUrl: string;
    let geminiFinalPrompt: string | null = null;
    let mjFinalPrompt: string | null = null;

    if (CONFIG.imageGen.provider === "gemini-3-pro-image") {
      // 使用 Gemini 3 Pro Image Preview
      console.log("   Provider: Gemini 3 Pro Image Preview (NanoBanana)");
      console.log(`   角色参考图: ${charRefUrl ? '✅ 已添加' : '❌ 无'}`);

      imageUrl = await gemini3ImageGenerate(rawPositive, negative, charRefUrl || undefined, seed);
      geminiFinalPrompt = buildGemini3Prompt({
        positivePrompt: rawPositive,
        negativePrompt: negative,
        seed,
        characterReferenceUrl: charRefUrl || undefined,
      });
    } else {
      // 使用 Midjourney（默认）
      const mjPrompt = buildMidjourneyPrompt(rawPositive, {
        aspectRatio: "16:9",
        stylize: 100,
        model: "--niji 6",
        seed,
        characterReferenceUrl: charRefUrl || undefined,
        negativePrompt: negative,
        negativeLimit: 10,
      });

      console.log(`   Provider: ${CONFIG.imageGen.provider}`);
      console.log(`   角色参考图: ${charRefUrl ? '✅ 已添加' : '❌ 无'}`);
      console.log(`   Prompt 长度: ${mjPrompt.length} 字符`);

      imageUrl = await mjGenerate(mjPrompt);
      mjFinalPrompt = mjPrompt;
    }

    // 生成 CG 名称
    const cgName = state.cgInput.cgName || `cg_${state.cgInput.source}_${Date.now()}`;

    // 下载保存图像（使用 state.outputDir 避免并行冲突）
    const cgOutputDir = path.join(state.outputDir, state.cgInput.source.replace("chapter", "ch").replace("_route_", "_"));
    ensureDir(cgOutputDir);

    const localPath = path.join(cgOutputDir, `${cgName}.png`);

    // 如果是 base64 数据，保存为文件
    if (imageUrl.startsWith("data:image")) {
      const base64Data = imageUrl.split(",")[1];
      fs.writeFileSync(localPath, Buffer.from(base64Data, "base64"));
      console.log(`   📥 保存 Base64 图像到: ${localPath}`);
    } else {
      console.log(`   📥 下载图像到: ${localPath}`);
      await downloadImage(imageUrl, localPath);
    }

    const generatedCG: GeneratedCG = {
      source: state.cgInput.source,
      cgName,
      cgTitle: state.cgInput.cgTitle,
      positivePrompt: rawPositive,
      negativePrompt: negative,
      analysis,
      imageUrl,
      localPath,
    };

    return {
      generatedCG,
      mjFinalPrompt: mjFinalPrompt,
      geminiFinalPrompt: geminiFinalPrompt,
      characterReferenceUrl: charRefUrl,
      currentStage: "save_output",
      messages: [new AIMessage(`[图像] CG 生成成功: ${cgName}`)],
    };
  } catch (error) {
    console.error(`   ❌ 图像生成失败: ${error}`);
    return {
      currentStage: "failed",
      error: `图像生成失败: ${error}`,
    };
  }
}

/**
 * 保存输出节点
 */
async function saveOutputNode(
  state: CGStateType
): Promise<Partial<CGStateType>> {
  console.log("\n💾 [Step 4] 保存元数据...");

  if (!state.generatedCG) {
    return {
      currentStage: "failed",
      error: "CG 未生成",
    };
  }

  try {
    const cg = state.generatedCG;
    const metaOutputDir = path.dirname(cg.localPath || state.outputDir);

    // 根据 provider 确定 imageGeneration 模型名称
    const imageGenModel = CONFIG.imageGen.provider === "gemini-3-pro-image"
      ? CONFIG.imageGen.geminiModel
      : "midjourney-niji-6";

    // 保存元数据
    const metadataPath = path.join(metaOutputDir, `${cg.cgName}_metadata.json`);
    const metadata: any = {
      schemaVersion: "1.0.0",
      assetType: "cg_image",
      source: cg.source,
      cgName: cg.cgName,
      title: cg.cgTitle,
      generatedAt: new Date().toISOString(),
      randomSeed: state.randomSeed,
      generator: {
        agent: "cg-agent",
        models: {
          promptTransform: CONFIG.llm.model,
          imageGeneration: imageGenModel,
        },
      },
      input: {
        settingsFile: state.cgInput.settingsFile,
        settingsFileSha256: fileSha256(state.cgInput.settingsFile),
        characterSpritePath: state.cgInput.characterSpritePath || null,
        characterSpriteSha256: state.cgInput.characterSpritePath
          ? fileSha256(state.cgInput.characterSpritePath)
          : null,
      },
      prompts: {
        llmRenderedPrompt: state.llmRenderedPrompt || null,
        positive: cg.positivePrompt,
        negative: cg.negativePrompt,
        midjourneyFinalPrompt: state.mjFinalPrompt || null,
        geminiFinalPrompt: state.geminiFinalPrompt || null,
      },
      promptContracts: {
        textToImage: {
          id: getCgPromptContractId(),
          version: PROMPT_CONTRACT_VERSION,
        },
      },
      references: {
        characterReferenceUrl: state.characterReferenceUrl || null,
      },
      analysis: cg.analysis,
      imagePath: cg.localPath,
      imagePathSha256: cg.localPath ? fileSha256(cg.localPath) : null,
      imageUrl: cg.imageUrl,
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    console.log(`   ✅ 元数据已保存: ${metadataPath}`);
    
    // 打印最终报告
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    CG 生成完成报告                          ║
╚════════════════════════════════════════════════════════════╝

📝 CG 信息:
   名称: ${cg.cgName}
   来源: ${cg.source}

🎨 生成的资源:
   ✅ CG 图像: ${cg.localPath}
   ✅ 元数据: ${metadataPath}

📋 提示词摘要:
   Positive: ${cg.positivePrompt.substring(0, 100)}...
   Negative: ${cg.negativePrompt.substring(0, 50)}...

════════════════════════════════════════════════════════════
`);
    
    return {
      currentStage: "completed",
      messages: [new AIMessage(`[完成] CG 已保存: ${cg.localPath}`)],
    };
  } catch (error) {
    console.error(`   ❌ 保存失败: ${error}`);
    return {
      currentStage: "failed",
      error: `保存失败: ${error}`,
    };
  }
}

// ============================================
// 路由函数
// ============================================

function routeByStage(state: CGStateType): string {
  switch (state.currentStage) {
    case "parse_settings":
      return "parse_settings";
    case "generate_prompt":
      return "generate_prompt";
    case "generate_image":
      return "generate_image";
    case "save_output":
      return "save_output";
    case "completed":
    case "failed":
      return END;
    default:
      return END;
  }
}

// ============================================
// 构建工作流
// ============================================

function buildCGWorkflow() {
  const workflow = new StateGraph(CGStateAnnotation)
    .addNode("init", initNode)
    .addNode("parse_settings", parseSettingsNode)
    .addNode("generate_prompt", generatePromptNode)
    .addNode("generate_image", generateImageNode)
    .addNode("save_output", saveOutputNode)
    .addEdge(START, "init")
    .addConditionalEdges("init", routeByStage)
    .addConditionalEdges("parse_settings", routeByStage)
    .addConditionalEdges("generate_prompt", routeByStage)
    .addConditionalEdges("generate_image", routeByStage)
    .addConditionalEdges("save_output", routeByStage);

  return workflow.compile();
}

// ============================================
// 导出接口
// ============================================

export interface CGGenerationResult {
  success: boolean;
  cg?: GeneratedCG;
  error?: string;
}

/**
 * 生成单个 CG
 */
export interface CGGenerationOptions {
  /** CG 输出目录 (默认 assets/cg/) */
  outputDir?: string;
}

export async function generateCG(input: CGInput, options?: CGGenerationOptions): Promise<CGGenerationResult> {
  // 输出目录通过 state 传递，避免并行冲突
  const outputDir = options?.outputDir || DEFAULT_CG_DIR;
  console.log(`   📁 CG 输出目录: ${outputDir}`);
  
  const workflow = buildCGWorkflow();
  
  const initialState: Partial<CGStateType> = {
    cgInput: input,
    currentStage: "init",
    outputDir: outputDir,  // 通过 state 传递，不再使用全局变量
    generatedPrompt: null,
    generatedCG: null,
    error: null,
    messages: [],
  };
  
  try {
    const result = await workflow.invoke(initialState);
    
    if (result.currentStage === "completed" && result.generatedCG) {
      return {
        success: true,
        cg: result.generatedCG,
      };
    } else {
      return {
        success: false,
        error: result.error || "未知错误",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * 批量生成所有章节的 CG
 */
export async function generateAllCGs(): Promise<{
  total: number;
  success: number;
  failed: number;
  results: CGGenerationResult[];
}> {
  console.log(`
============================================================
🎨 CG 批量生成脚本
============================================================
`);

  // 查找所有 settings 文件
  const settingsFiles: { source: CGSource; path: string }[] = [];
  
  // Chapter 1
  const settings1 = path.join(STORY_DIR, "settings_1.txt");
  if (fs.existsSync(settings1)) {
    settingsFiles.push({ source: "chapter1", path: settings1 });
  }
  
  // Chapter 2 & 3 routes
  const routes = ["a", "b", "c"] as const;
  for (const route of routes) {
    const settings2 = path.join(STORY_DIR, `route_${route}`, "settings_2.txt");
    const settings3 = path.join(STORY_DIR, `route_${route}`, "settings_3.txt");
    
    if (fs.existsSync(settings2)) {
      settingsFiles.push({
        source: `chapter2_route_${route}` as CGSource,
        path: settings2,
      });
    }
    if (fs.existsSync(settings3)) {
      settingsFiles.push({
        source: `chapter3_route_${route}` as CGSource,
        path: settings3,
      });
    }
  }
  
  console.log(`📁 发现 ${settingsFiles.length} 个 settings 文件:`);
  settingsFiles.forEach((f, i) => {
    console.log(`   ${i + 1}. ${f.source} -> ${path.basename(f.path)}`);
  });
  
  const results: CGGenerationResult[] = [];
  let successCount = 0;
  let failCount = 0;
  
  for (const { source, path: settingsPath } of settingsFiles) {
    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`🚀 生成 CG: ${source}`);
    console.log(`────────────────────────────────────────────────────────────`);
    
    const result = await generateCG({
      source,
      settingsFile: settingsPath,
      sceneDescription: "",
      characterDescription: "",
    });
    
    results.push(result);
    
    if (result.success) {
      successCount++;
      console.log(`✅ ${source} CG 生成成功!`);
    } else {
      failCount++;
      console.log(`❌ ${source} CG 生成失败: ${result.error}`);
    }
  }
  
  console.log(`
============================================================
📊 批量生成完成
============================================================
   总计: ${settingsFiles.length}
   成功: ${successCount}
   失败: ${failCount}
============================================================
`);

  return {
    total: settingsFiles.length,
    success: successCount,
    failed: failCount,
    results,
  };
}

// ============================================
// CLI 入口
// ============================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes("--all")) {
    // 生成所有 CG
    await generateAllCGs();
  } else if (args.includes("--source")) {
    // 生成指定来源的 CG
    const sourceIndex = args.indexOf("--source");
    const source = args[sourceIndex + 1] as CGSource;
    
    if (!source) {
      console.error("请指定 --source 参数，例如: --source chapter1");
      process.exit(1);
    }
    
    // 根据 source 找到对应的 settings 文件
    let settingsPath: string;
    if (source === "chapter1") {
      settingsPath = path.join(STORY_DIR, "settings_1.txt");
    } else if (source.startsWith("chapter2_route_")) {
      const route = source.replace("chapter2_route_", "");
      settingsPath = path.join(STORY_DIR, `route_${route}`, "settings_2.txt");
    } else if (source.startsWith("chapter3_route_")) {
      const route = source.replace("chapter3_route_", "");
      settingsPath = path.join(STORY_DIR, `route_${route}`, "settings_3.txt");
    } else {
      console.error(`未知的 source: ${source}`);
      process.exit(1);
    }
    
    const result = await generateCG({
      source,
      settingsFile: settingsPath,
      sceneDescription: "",
      characterDescription: "",
    });
    
    if (result.success) {
      console.log(`\n✅ CG 生成成功!`);
    } else {
      console.error(`\n❌ CG 生成失败: ${result.error}`);
      process.exit(1);
    }
  } else {
    console.log(`
CG 生成工具

用法:
  tsx cg-agent.ts --all              生成所有章节的 CG
  tsx cg-agent.ts --source <source>  生成指定章节的 CG

可用的 source:
  - chapter1
  - chapter2_route_a
  - chapter2_route_b
  - chapter2_route_c
  - chapter3_route_a
  - chapter3_route_b
  - chapter3_route_c
`);
  }
}

// 仅在直接运行时执行（不是被 import 时）
const isMainModule = process.argv[1]?.includes("cg-agent");
if (isMainModule) {
  main().catch(console.error);
}
