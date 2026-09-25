/**
 * LangGraph 角色立绘生成流水线 Agent
 * Character Sprite Generation Pipeline Agent
 *
 * 完整流程：
 * 1. Midjourney 生成正面立绘 (2:3 比例)
 * 2. Gemini 3 Pro Image 润色立绘
 * 3. Gemini 3 Pro Image 生成表情表 (2x2 四种表情)
 * 4. 头像裁剪 (肩部以上，1:1 比例)
 * 5. 抠图 (去除白色背景)
 *
 * @see prompts/README.md 查看提示词模板说明
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  BaseMessage,
} from "@langchain/core/messages";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { compilePrompt } from "./services/prompt-compiler.js";
import { buildMidjourneyPrompt } from "./services/image-prompt-renderer.js";
import { PROMPT_CONTRACT_VERSION } from "./services/prompt-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 轮询配置
const POLLING_INTERVAL = 10; // 秒
const MAX_POLLS = 60;

// 资源目录结构
const ASSETS_BASE = path.resolve(__dirname, "../../assets");
const DEFAULT_CHARACTERS_DIR = path.join(ASSETS_BASE, "characters"); // 默认角色资源目录
const PROMPTS_DIR = path.join(__dirname, "prompts/image");   // 图像提示词目录

function getImagePromptContractId(base: "sprite"): string {
  if ((process.env.PROMPT_BRANCH || "").toLowerCase() === "v2") {
    return "image_v2/midjourney_character_sprite";
  }
  return "image/midjourney_character_sprite";
}

/**
 * 获取角色资源目录
 * 结构: {outputDir}/{角色名}/
 * @param outputDir 输出基础目录（不再使用全局变量，避免并行冲突）
 */
function getCharacterDir(characterName: string, outputDir: string): string {
  const safeName = characterName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  return path.join(outputDir, safeName);
}

/**
 * 确保角色目录结构存在
 * @param outputDir 输出基础目录（传入避免并行冲突）
 */
function ensureCharacterDirs(characterName: string, outputDir: string): { 
  baseDir: string; 
  nobgDir: string; 
} {
  const baseDir = getCharacterDir(characterName, outputDir);
  const nobgDir = path.join(baseDir, "nobg");
  
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  if (!fs.existsSync(nobgDir)) {
    fs.mkdirSync(nobgDir, { recursive: true });
  }
  
  return { baseDir, nobgDir };
}

// ============================================
// 1. 类型定义
// ============================================

/** 角色设定输入 */
interface CharacterInput {
  name: string; // 角色名称
  worldSetting: string; // 世界观设定
  appearance: string; // 外貌描述
  personality?: string; // 性格描述（可选）
  outfit?: string; // 服装描述（可选）
  accessories?: string; // 配饰描述（眼镜、头饰、徽章等）
}

/** 表情类型 */
type ExpressionType = "happy" | "angry" | "sad" | "laughing";

/** 生成的图像信息 */
interface GeneratedImage {
  type: "sprite" | "polished" | "expression" | "portrait";
  expression?: ExpressionType;
  url: string;
  localPath?: string;
  hasBackground: boolean; // true = 有背景，false = 已抠图
}

/** 流水线阶段 */
type PipelineStage =
  | "init"
  | "mj_sprite" // Midjourney 生成立绘
  | "gemini_polish" // Gemini 3 Pro Image 润色
  | "gemini_expression" // Gemini 3 Pro Image 生成表情
  | "crop_portrait" // 裁剪头像
  | "remove_bg" // 抠图
  | "completed"
  | "failed";

// ============================================
// 2. 定义状态 Schema
// ============================================

const CharacterSpriteState = Annotation.Root({
  // 输入：角色设定
  characterInput: Annotation<CharacterInput>({
    reducer: (_, newVal) => newVal,
    default: () => ({
      name: "",
      worldSetting: "",
      appearance: "",
    }),
  }),

  // 输出目录（避免并行冲突，每个任务独立）
  outputDir: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => DEFAULT_CHARACTERS_DIR,
  }),

  // 当前流水线阶段
  currentStage: Annotation<PipelineStage>({
    reducer: (_, newVal) => newVal,
    default: () => "init",
  }),
  
  // 随机种子（用于所有模型）
  randomSeed: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),

  // Midjourney 提示词
  mjPrompt: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),

  // Gemini 3 Pro Image 表情提示词
  expressionPrompt: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),

  // Gemini 3 Pro Image 润色提示词
  polishPrompt: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),

  // 任务 ID 映射
  taskIds: Annotation<Record<string, string>>({
    reducer: (prev, newVal) => ({ ...prev, ...newVal }),
    default: () => ({}),
  }),

  // 生成的图像列表
  generatedImages: Annotation<GeneratedImage[]>({
    reducer: (prev, newVal) => [...prev, ...newVal],
    default: () => [],
  }),

  // 原始立绘 URL (用于后续步骤的参考)
  baseSpriteUrl: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),

  // 润色后立绘 URL
  polishedSpriteUrl: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),

  // 表情图 URL (2x2 网格)
  expressionSheetUrl: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),

  // 重试次数
  retryCount: Annotation<number>({
    reducer: (_, newVal) => newVal,
    default: () => 0,
  }),

  // 错误信息
  error: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),

  // 消息历史
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, newVal) => [...prev, ...newVal],
    default: () => [],
  }),
});

type CharacterSpriteStateType = typeof CharacterSpriteState.State;

// ============================================
// 3. 配置和工具函数
// ============================================

/** 加载 API 配置 */
function loadApiConfig() {
  const configPath = path.join(__dirname, "config", "api-config.json");
  try {
    const configContent = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(configContent);
  } catch (error) {
    console.warn("⚠️ 无法加载 API 配置文件，使用默认配置");
    return null;
  }
}

const API_CONFIG = loadApiConfig();

/** API 配置 */
const CONFIG = {
  // Midjourney API (xiaochuanai.com)
  midjourney: {
    apiKey: API_CONFIG?.["midjourney-image"]?.api_key || process.env.MIDJOURNEY_API_KEY || "",
    baseUrl: API_CONFIG?.["midjourney-image"]?.base_url || "REDACTED_CONFIGURE_LOCALLY",
  },
  // Gemini 3 Pro Image (Vertex AI) - 用于润色和表情生成
  geminiImage: {
    model: "gemini-3-pro-image-preview",
    project: API_CONFIG?.["vertex-chat"]?.api_key || "REDACTED_CONFIGURE_LOCALLY",
    location: API_CONFIG?.["vertex-chat"]?.location || "global",
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || 
      "/path/to/local-resource",
  },
  // Google Gemini API (用于文本处理)
  googleChat: {
    apiKey: API_CONFIG?.["google-chat"]?.api_key || process.env.GOOGLE_API_KEY || "",
  },
  // 抠图工具
  backgroundRemoval: {
    tool: "mj-api", // rembg | remove.bg | mj-api (xiaochuanai)
    apiKey: process.env.REMOVEBG_API_KEY || "",
    // xiaochuanai 提供抠图 API: /tob/remove-background
  },
  // Hugging Face (用于 RMBG-1.4 抠图)
  huggingFace: {
    token: API_CONFIG?.["huggingface"]?.api_key || process.env.HF_TOKEN || "",
  },
};

// 设置 Google 应用凭据
if (fs.existsSync(CONFIG.geminiImage.credentialsPath)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = CONFIG.geminiImage.credentialsPath;
}

/** 检查是否使用模拟模式 */
const USE_MOCK_MODE = !CONFIG.googleChat.apiKey && !fs.existsSync(CONFIG.geminiImage.credentialsPath);

/** 解析 API Key */
function parseApiKey(apiKey: string) {
  const parts = apiKey.split("|");
  return {
    x_app: parts[0] || "",
    x_secret: parts[1] || "",
  };
}

/** 读取提示词模板 */
function readPromptTemplate(templateName: string): string {
  const templatePath = path.join(__dirname, "prompts", templateName);
  try {
    return fs.readFileSync(templatePath, "utf-8");
  } catch (error) {
    console.warn(`⚠️ 无法读取模板 ${templateName}，使用默认值`);
    return "";
  }
}

/** 创建文本 LLM 模型 (用于一般文本处理) */
function createTextModel() {
  const apiKey = CONFIG.googleChat.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  
  if (!apiKey && USE_MOCK_MODE) {
    console.log("⚠️ 未设置 LLM API Key，将使用模拟模式");
    return null;
  }

  // 优先使用 Vertex AI (如果有服务账号凭据)
  if (fs.existsSync(CONFIG.geminiImage.credentialsPath)) {
    return new ChatVertexAI({
      model: "gemini-2.0-flash",
      temperature: 0.7,
    });
  }

  // 使用 Google Gemini API
  if (apiKey) {
    return new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: apiKey,
      temperature: 0.7,
    });
  }

  return null;
}

/** 创建图像生成模型 (Gemini 3 Pro Image) */
function createImageModel() {
  if (USE_MOCK_MODE) {
    console.log("⚠️ 未配置 Vertex AI 凭据，将使用模拟模式");
    return null;
  }

  // 使用 gemini-3-pro-image-preview，location 必须是 global
  return new ChatVertexAI({
    model: "gemini-3-pro-image-preview",
    location: "global",
    temperature: 0.7,
  });
}

/** 延迟函数 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================
// 4. 提示词生成函数
// ============================================

/**
 * 从提示词文件加载 Midjourney 模板
 */
function loadMjPromptTemplate(): string {
  const templatePath = path.join(PROMPTS_DIR, "midjourney_character_sprite.txt");
  try {
    const content = fs.readFileSync(templatePath, "utf-8");
    // 提取基础模板部分（## 基础模板 后的第一行非空内容到 --ar 之前）
    const match = content.match(/## 基础模板[^\n]*\n\n([^\n]+)/);
    if (match) {
      return match[1].trim();
    }
    // 如果没找到，使用默认模板（带新变量格式）
    return "game character sprite, tachi-e, knee-up shot, {{WORLD_SETTING}}, {{CHARACTER_APPEARANCE}}, {{CHARACTER_OUTFIT}}, simple pure white background, isolated on white, anime style, standing pose, cel shading, flat color, clear contour, clean lines, high quality, masterpiece, head fully visible, ample headroom, white space around subject";
  } catch (error) {
    console.warn("⚠️ 无法加载 MJ 提示词模板，使用默认值");
    return "game character sprite, tachi-e, knee-up shot, {{WORLD_SETTING}}, {{CHARACTER_APPEARANCE}}, {{CHARACTER_OUTFIT}}, simple pure white background, isolated on white, anime style, standing pose, cel shading, flat color, clear contour, clean lines, high quality, masterpiece, head fully visible, ample headroom, white space around subject";
  }
}

/**
 * 从提示词文件加载 Gemini 表情模板
 */
function loadExpressionPromptTemplate(): string {
  const templatePath = path.join(PROMPTS_DIR, "gemini_expression_sheet.txt");
  try {
    const content = fs.readFileSync(templatePath, "utf-8");
    // 提取基础模板部分
    const match = content.match(/## 基础模板.*?\n\n(.*?)\n\n## 表情分解/s);
    if (match) {
      return match[1].trim();
    }
    return "生成一张2x2网格布局的表情表。四个表情分别位于：左上、右上、左下、右下。【重要规则】1. 每个格子只能有一个角色，严禁出现两个或多个人物 2. 四个格子必须严格等分 3. 整张图只能出现同一个角色的4种不同表情 4. 每个表情都是膝盖以上的角色图像，构图一致 5. 白色背景。【表情定义】- 左上：开心微笑，睁着眼睛，嘴角上扬 - 右上：生气表情，皱眉，不满的表情 - 左下：悲伤表情，眼角有泪，嘴角下垂 - 右下：大笑表情，眯起眼睛，非常开心。";
  } catch (error) {
    console.warn("⚠️ 无法加载表情提示词模板，使用默认值");
    return "生成一张以参考图1中的角色为原型的2*2的不同表情的图片。【重要：每个格子里只能有一个角色，严禁出现两个或多个人物】表情和动作相匹配。第一张图，角色睁着眼睛微笑，开心的表情。第二张图，角色有些生气的表情，第三张图，角色悲伤的图，第四张图，角色眯起眼睛大笑，非常开心的表情。每张图都是相同的1：1大小，生成与参考图1角色大小一致的膝盖以上的角色图像方法，生成正确的手和脚。禁止只生成胸部以上的表情图。【整张图只有同一个角色的4种表情，绝对不能出现第二个人物】";
  }
}

/**
 * 生成 Midjourney 立绘提示词
 * 使用 prompts/midjourney_character_sprite.txt 模板
 */
function buildMjSpritePrompt(input: CharacterInput, seed: number): string {
  const spriteContractId = getImagePromptContractId("sprite");
  // 组合服装和配饰
  let outfitWithAccessories = input.outfit || "japanese school uniform, white shirt, navy blazer, pleated skirt";
  if (input.accessories) {
    // 配饰信息追加到服装后面
    outfitWithAccessories = `${outfitWithAccessories}, ${input.accessories}`;
  }

  const positivePrompt = compilePrompt(spriteContractId, {
    CHARACTER_APPEARANCE: input.appearance || "young anime girl",
    CHARACTER_OUTFIT: outfitWithAccessories,
  }).renderedPrompt
    .split("\n")
    .find(line => line.includes("game character sprite"))?.trim()
    || "game character sprite, tachi-e, knee-up shot, anime style";

  return buildMidjourneyPrompt(positivePrompt, {
    aspectRatio: "2:3",
    stylize: 100,
    model: "--niji 6",
    seed,
    negativePrompt: "lowres, bad anatomy, extra limbs, extra legs, extra arms, missing limbs, fused limbs, mutated hands, poorly drawn hands, malformed hands, extra fingers, fewer fingers, bad proportions, gross proportions, deformed, mutation, disfigured",
    negativeLimit: 50,
  });
}

/**
 * 生成 Gemini 表情提示词
 * 使用 prompts/gemini_expression_sheet.txt 模板
 */
function buildExpressionPrompt(): string {
  return loadExpressionPromptTemplate();
}

function createRandomSeed(): string {
  return `${Math.floor(Math.random() * 4294967295)}`;
}

function appendSeedNote(prompt: string, seed: string): string {
  return `${prompt}\n\n随机种子：${seed}\n请使用此随机种子增加随机性，但保持格式与内容要求。`;
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

function writeImageMetadata(
  imagePath: string,
  metadata: Record<string, unknown>
): void {
  const ext = path.extname(imagePath);
  const base = ext ? imagePath.slice(0, -ext.length) : imagePath;
  const metadataPath = `${base}_metadata.json`;
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
}

// ============================================
// 5. 节点函数
// ============================================

/**
 * 初始化节点 - 准备提示词
 */
async function initNode(
  state: CharacterSpriteStateType
): Promise<Partial<CharacterSpriteStateType>> {
  console.log("\n🚀 [初始化] 准备角色立绘生成流水线...");
  console.log(`   角色名称: ${state.characterInput.name}`);
  console.log(`   世界观: ${state.characterInput.worldSetting}`);
  console.log(`   外貌: ${state.characterInput.appearance}`);

  const randomSeed = state.randomSeed || createRandomSeed();
  
  // 生成 Midjourney 提示词
  const mjPrompt = buildMjSpritePrompt(state.characterInput, Number(randomSeed));
  console.log(`   MJ 提示词: ${mjPrompt.substring(0, 100)}...`);

  // 生成表情提示词
  const expressionPrompt = appendSeedNote(buildExpressionPrompt(), randomSeed);

  return {
    currentStage: "mj_sprite",
    mjPrompt,
    expressionPrompt,
    randomSeed,
    messages: [new AIMessage(`[初始化完成] 角色: ${state.characterInput.name}`)],
  };
}

/**
 * 下载图片到本地
 */
async function downloadImage(url: string, savePath: string): Promise<boolean> {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    fs.writeFileSync(savePath, response.data);
    console.log(`   ✅ 已保存: ${savePath}`);
    return true;
  } catch (error: any) {
    console.log(`   ❌ 下载失败: ${error.message}`);
    return false;
  }
}


/**
 * Midjourney 立绘生成节点（含轮询和下载）
 * 
 * MJ 会返回 4 张变体，我们选择第 1 张作为基础立绘
 */
async function mjSpriteNode(
  state: CharacterSpriteStateType
): Promise<Partial<CharacterSpriteStateType>> {
  console.log("\n🎨 [Step 1] Midjourney 生成正面立绘 (2:3 膝盖以上)...");
  console.log(`   Prompt: ${state.mjPrompt.substring(0, 80)}...`);

  // 检查 API Key
  if (!CONFIG.midjourney.apiKey) {
    console.log("   ⚠️ 未配置 Midjourney API Key，使用模拟模式");
    await delay(2000);

    const characterName = state.characterInput.name || "character";
    const { baseDir } = ensureCharacterDirs(characterName, state.outputDir);
    const mockUrl = `https://example.com/mock-sprite-${Date.now()}.png`;
    const mockPath = path.join(baseDir, "base_sprite.png");
    
    return {
      currentStage: "gemini_polish",
      baseSpriteUrl: mockUrl,
      taskIds: { mj_sprite: `mock-${Date.now()}` },
      generatedImages: [
        {
          type: "sprite",
          url: mockUrl,
          localPath: mockPath,
          hasBackground: true,
        },
      ],
      messages: [new AIMessage(`[模拟] Midjourney 立绘生成完成`)],
    };
  }

  try {
    const { x_app, x_secret } = parseApiKey(CONFIG.midjourney.apiKey);
    const headers = {
      "Content-Type": "application/json",
      "x-youchuan-app": x_app,
      "x-youchuan-secret": x_secret,
    };

    // 1. 提交生成任务
    console.log("   📤 提交生成任务...");
    const response = await axios.post(
      `${CONFIG.midjourney.baseUrl}/tob/diffusion`,
      { text: state.mjPrompt },
      { headers, timeout: 60000 }
    );

    const jobId = response.data.id;
    if (!jobId) {
      throw new Error("未获取到任务 ID");
    }
    console.log(`   ✅ 任务已提交, Job ID: ${jobId}`);

    // 2. 轮询获取结果
    console.log(`   ⏳ 轮询任务状态 (间隔 ${POLLING_INTERVAL} 秒)...`);
    
    let pollCount = 0;
    while (pollCount < MAX_POLLS) {
      pollCount++;
      await delay(POLLING_INTERVAL * 1000);

      try {
        const pollResponse = await axios.get(
          `${CONFIG.midjourney.baseUrl}/tob/job/${jobId}`,
          { headers, timeout: 30000 }
        );

        const comment = pollResponse.data.comment || "";
        const time = new Date().toTimeString().split(" ")[0];
        console.log(`   [${time}] 轮询 #${pollCount}: ${comment}`);

        if (comment === "完成" || comment === "成功") {
          const urls = pollResponse.data.urls || [];
          if (urls.length > 0) {
            console.log(`   ✅ 生成成功！MJ 返回 ${urls.length} 张变体`);
            console.log(`   📌 选择第 1 张作为基础立绘`);

            // 3. 创建角色目录并下载第 1 张作为基础立绘
            const characterName = state.characterInput.name || "character";
            const { baseDir } = ensureCharacterDirs(characterName, state.outputDir);
            
            const baseSpriteUrl = urls[0];
            const localPath = path.join(baseDir, "base_sprite.png");
            
            console.log(`   📁 角色目录: ${baseDir}`);
            console.log(`   📥 下载基础立绘...`);
            await downloadImage(baseSpriteUrl, localPath);

            const baseSprite: GeneratedImage = {
              type: "sprite",
              url: baseSpriteUrl,
              localPath: localPath,
              hasBackground: true,
            };

            return {
              currentStage: "gemini_polish",
              baseSpriteUrl: baseSpriteUrl,
              taskIds: { mj_sprite: jobId },
              generatedImages: [baseSprite],
              messages: [new AIMessage(`[成功] 基础立绘已保存: ${localPath}`)],
            };
          }
        } else if (comment !== "执行中" && comment !== "排队中") {
          throw new Error(`任务失败: ${comment}`);
        }
      } catch (pollError: any) {
        if (pollError.message.includes("任务失败")) {
          throw pollError;
        }
        console.log(`   ⚠️ 轮询请求失败: ${pollError.message}`);
      }
    }

    throw new Error(`轮询超时 (已尝试 ${MAX_POLLS} 次)`);
  } catch (error: any) {
    console.error("   ❌ Midjourney 调用失败:", error.message);
    return {
      error: `Midjourney 调用失败: ${error.message}`,
      currentStage: "failed",
      retryCount: state.retryCount + 1,
    };
  }
}

/**
 * Gemini 3 Pro Image 润色节点
 * 暂时跳过，直接进入表情生成
 */
async function geminiPolishNode(
  state: CharacterSpriteStateType
): Promise<Partial<CharacterSpriteStateType>> {
  console.log("\n✨ [Step 2] Gemini 3 Pro Image 润色立绘...");
  
  const characterName = state.characterInput.name || "character";
  const { baseDir } = ensureCharacterDirs(characterName, state.outputDir);
  const baseSpriteLocalPath = path.join(baseDir, "base_sprite.png");
  
  if (!fs.existsSync(baseSpriteLocalPath)) {
    console.log(`   ⚠️ 基础立绘不存在: ${baseSpriteLocalPath}`);
    console.log("   跳过润色，直接进入表情生成");
    return {
      currentStage: "gemini_expression",
      messages: [new AIMessage(`[跳过] 基础立绘不存在，跳过润色`)],
    };
  }
  
  console.log(`   基础立绘: ${baseSpriteLocalPath}`);
  
  try {
    // 读取基础立绘并转为 Base64
    const imageBase64 = await imageToBase64(baseSpriteLocalPath);
    console.log(`   Base64 长度: ${imageBase64.length}`);
    
    // 构建润色提示词
    const polishPrompt = appendSeedNote(`请对这张游戏角色立绘进行润色优化：
1. 保持角色的所有特征不变（服装、发型、配饰等）
2. 优化线条清晰度和色彩饱和度
3. 保持白色背景
4. 保持 2:3 的纵向比例
5. 确保是膝盖以上的立绘

输出一张高质量的润色后角色立绘图片。`, state.randomSeed || createRandomSeed());
    
    // 创建 Gemini 模型
    const model = new ChatVertexAI({
      model: "gemini-3-pro-image-preview",
      location: "global",
      temperature: 0.7,
    });
    
    console.log("   🎨 调用 Gemini 3 Pro Image 润色...");
    
    const response = await model.invoke([
      new HumanMessage({
        content: [
          { type: "text", text: polishPrompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      }),
    ]);
    
    // 解析响应，提取图像
    let polishedPath = "";
    if (Array.isArray(response.content)) {
      for (const part of response.content) {
        if (typeof part === "object" && part !== null && (part as any).type === "image_url") {
          const imageUrlData = (part as any).image_url;
          let imageData: string | undefined;
          
          if (typeof imageUrlData === "string") {
            imageData = imageUrlData;
          } else if (typeof imageUrlData === "object" && imageUrlData?.url) {
            imageData = imageUrlData.url;
          }
          
          if (imageData && imageData.startsWith("data:image")) {
            polishedPath = path.join(baseDir, "polished_sprite.png");
            const base64Data = imageData.split(",")[1];
            fs.writeFileSync(polishedPath, Buffer.from(base64Data, "base64"));
            console.log(`   ✅ 润色后立绘已保存: ${polishedPath}`);
            break;
          }
        }
      }
    }
    
    if (!polishedPath) {
      console.log("   ⚠️ Gemini 未返回图像，使用原始立绘继续");
      return {
        currentStage: "gemini_expression",
        polishPrompt,
        messages: [new AIMessage(`[警告] 润色未返回图像，使用原始立绘`)],
      };
    }
    
    // 更新 generatedImages，添加润色后的立绘
    const updatedImages = [...state.generatedImages];
    updatedImages.push({
      type: "polished",
      url: polishedPath,
      localPath: polishedPath,
      hasBackground: true,
    });
    
    return {
      currentStage: "gemini_expression",
      polishedSpriteUrl: polishedPath,
      polishPrompt,
      generatedImages: updatedImages,
      messages: [new AIMessage(`[完成] 立绘润色成功: ${polishedPath}`)],
    };
    
  } catch (error: any) {
    console.log(`   ❌ 润色失败: ${error.message}`);
    console.log("   使用原始立绘继续流程");
    return {
      currentStage: "gemini_expression",
      polishPrompt: state.polishPrompt,
      messages: [new AIMessage(`[跳过] 润色失败: ${error.message}`)],
    };
  }
}

/**
 * 读取图片并转为 Base64
 */
async function imageToBase64(imagePath: string): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString("base64");
}

/**
 * Gemini 3 Pro Image 表情生成节点
 * 
 * 基于基础立绘，生成 1 张 2x2 的表情表（包含开心、生气、悲伤、大笑）
 */
async function geminiExpressionNode(
  state: CharacterSpriteStateType
): Promise<Partial<CharacterSpriteStateType>> {
  console.log("\n😀 [Step 3] Gemini 3 Pro Image 生成 2x2 表情表...");
  console.log(`   参考立绘: ${state.baseSpriteUrl?.substring(0, 60)}...`);
  console.log(`   表情: 开心、生气、悲伤、大笑`);

  // 找到基础立绘的本地路径
  const baseSprite = state.generatedImages.find(img => img.type === "sprite");
  const baseSpritePath = baseSprite?.localPath;

  if (USE_MOCK_MODE || !baseSpritePath) {
    console.log("   ⚠️ 未配置凭据或找不到基础立绘，使用模拟模式");
    await delay(2000);

    const characterName = state.characterInput.name || "character";
    const { baseDir } = ensureCharacterDirs(characterName, state.outputDir);
    const mockExpressionPath = path.join(baseDir, "expression_sheet.png");

    // 模拟：表情表是 1 张图，包含 2x2 的四种表情
    const expressionSheet: GeneratedImage = {
      type: "expression",
      url: `mock://expression_sheet`,
      localPath: mockExpressionPath,
      hasBackground: true,
    };

    return {
      currentStage: "crop_portrait",
      expressionSheetUrl: mockExpressionPath,
      generatedImages: [expressionSheet],
      messages: [new AIMessage(`[模拟] 2x2 表情表生成完成`)],
    };
  }

  try {
    const imageModel = createImageModel();
    if (!imageModel) {
      throw new Error("无法创建图像模型");
    }

    // 读取基础立绘并转为 Base64
    console.log(`   📖 读取基础立绘: ${baseSpritePath}`);
    const imageBase64 = await imageToBase64(baseSpritePath);

    // Gemini 3 Pro Image 表情生成提示词
    const expressionPrompt = appendSeedNote(`${state.expressionPrompt}

基于参考图中的角色，生成一张 2x2 网格的表情图：
- 左上：开心微笑
- 右上：生气
- 左下：悲伤  
- 右下：大笑

要求：
1. 输出 1 张包含 4 个表情的图片（2行2列）
2. 【重要】每个格子只能有一个角色，整张图只能出现同一个角色的4种不同表情
3. 每个表情构图一致，膝盖以上
4. 保持角色的服装、发型、配饰完全一致
5. 白色背景
6. 【严禁】出现两个或多个人物，不要生成对话场景`, state.randomSeed || createRandomSeed());

    // 调用 Gemini 3 Pro Image 生成表情
    const response = await imageModel.invoke([
      new HumanMessage({
        content: [
          { type: "text", text: expressionPrompt },
          { 
            type: "image_url", 
            image_url: { url: `data:image/png;base64,${imageBase64}` } 
          }
        ],
      }),
    ]);

    // 解析响应，提取生成的图像
    // Gemini 3 Pro Image 的响应中应该包含生成的图像
    const responseContent = response.content;
    let expressionSheetUrl = "";
    let expressionSheetPath = "";

    // 解析响应 - Gemini 3 Pro Image 返回数组，最后一个元素是 image_url
    const characterName = state.characterInput.name || "character";
    const { baseDir } = ensureCharacterDirs(characterName, state.outputDir);
    
    console.log(`   响应类型: ${typeof responseContent}`);
    
    if (Array.isArray(responseContent)) {
      console.log(`   响应数组长度: ${responseContent.length}`);
      
      // 遍历查找 image_url 类型的元素
      for (let i = 0; i < responseContent.length; i++) {
        const part = responseContent[i];
        console.log(`   [${i}] 元素类型: ${typeof part}, 键: ${typeof part === "object" && part !== null ? Object.keys(part).join(",") : "N/A"}`);
        
        if (typeof part === "object" && part !== null && "type" in part) {
          const partType = (part as any).type;
          console.log(`       type: ${partType}`);
          
          if (partType === "image_url") {
            // 找到生成的图像
            console.log(`       找到 image_url 元素!`);
            const imageUrlData = (part as any).image_url;
            
            // image_url 可能是字符串或对象
            let imageData: string | undefined;
            if (typeof imageUrlData === "string") {
              imageData = imageUrlData;
              console.log(`       image_url 是字符串，长度: ${imageData.length}`);
            } else if (typeof imageUrlData === "object" && typeof imageUrlData?.url === "string") {
              const urlStr = imageUrlData.url as string;
              imageData = urlStr;
              console.log(`       image_url 是对象，url 长度: ${urlStr.length}`);
            }
            
            if (imageData) {
              console.log(`       前缀: ${imageData.substring(0, 30)}`);
              if (imageData.startsWith("data:image")) {
                // Base64 图像，保存到角色目录
                expressionSheetPath = path.join(baseDir, "expression_sheet.png");
                
                const base64Data = imageData.split(",")[1];
                fs.writeFileSync(expressionSheetPath, Buffer.from(base64Data, "base64"));
                expressionSheetUrl = expressionSheetPath;
                console.log(`   ✅ 表情表已保存: ${expressionSheetPath}`);
                break;
              }
            }
          } else if (partType === "reasoning") {
            // 思考过程
            const reasoning = (part as any).reasoning;
            if (reasoning) {
              console.log(`   💭 思考: ${reasoning.substring(0, 50)}...`);
            }
          }
        }
      }
    } else if (typeof responseContent === "string") {
      console.log(`   📝 文本响应: ${responseContent.substring(0, 100)}...`);
    }

    if (!expressionSheetPath) {
      throw new Error("模型未返回图像");
    }

    const expressionSheet: GeneratedImage = {
      type: "expression",
      url: expressionSheetUrl,
      localPath: expressionSheetPath,
      hasBackground: true,
    };

    // 裁切 2x2 表情表为 4 张独立图片
    console.log("\n   ✂️ 裁切表情表为 4 张独立图片...");
    const expressionImages: GeneratedImage[] = [expressionSheet];
    
    try {
      const sheetMetadata = await sharp(expressionSheetPath).metadata();
      const sheetWidth = sheetMetadata.width || 0;
      const sheetHeight = sheetMetadata.height || 0;
      
      const cellWidth = Math.floor(sheetWidth / 2);
      const cellHeight = Math.floor(sheetHeight / 2);
      
      console.log(`      表情表尺寸: ${sheetWidth}x${sheetHeight}, 单格: ${cellWidth}x${cellHeight}`);
      
      const expressionPositions = [
        { name: "happy", row: 0, col: 0 },    // 左上 - 开心
        { name: "angry", row: 0, col: 1 },    // 右上 - 生气
        { name: "sad", row: 1, col: 0 },      // 左下 - 悲伤
        { name: "joy", row: 1, col: 1 },      // 右下 - 大笑
      ];
      
      for (const { name, row, col } of expressionPositions) {
        const outputPath = path.join(baseDir, `expression_${name}.png`);
        await sharp(expressionSheetPath)
          .extract({
            left: col * cellWidth,
            top: row * cellHeight,
            width: cellWidth,
            height: cellHeight,
          })
          .toFile(outputPath);
        
        expressionImages.push({
          type: "expression",
          expression: name as ExpressionType,
          url: outputPath,
          localPath: outputPath,
          hasBackground: true,
        });
        console.log(`      ✅ ${name}: ${outputPath}`);
      }
    } catch (cropError: any) {
      console.log(`      ⚠️ 表情裁切失败: ${cropError.message}`);
    }

    return {
      currentStage: "crop_portrait",
      expressionSheetUrl: expressionSheetPath,
      generatedImages: expressionImages,
      messages: [new AIMessage(`[成功] 2x2 表情表已保存并裁切: ${expressionSheetPath}`)],
    };
  } catch (error: any) {
    console.error("   ❌ Gemini 表情生成失败:", error.message);
    return {
      error: `Gemini 表情生成失败: ${error.message}`,
      currentStage: "failed",
    };
  }
}

/**
 * 头像裁剪节点
 * 从基础立绘裁剪肩部以上头像 (1:1 比例)
 */
async function cropPortraitNode(
  state: CharacterSpriteStateType
): Promise<Partial<CharacterSpriteStateType>> {
  console.log("\n✂️ [Step 4] 裁剪头像 (中间上半 1/3，1:1 比例)...");

  const characterName = state.characterInput.name || "character";
  const { baseDir } = ensureCharacterDirs(characterName, state.outputDir);

  // 找到基础立绘或润色后的立绘
  const polishedSprite = state.generatedImages.find(img => img.type === "polished");
  const baseSprite = state.generatedImages.find(img => img.type === "sprite");
  const sourceImage = polishedSprite?.localPath || baseSprite?.localPath;
  
  if (!sourceImage || !fs.existsSync(sourceImage)) {
    console.log("   ⚠️ 找不到立绘文件，跳过裁剪");
    return {
      currentStage: "remove_bg",
      messages: [new AIMessage(`[跳过] 头像裁剪（找不到立绘文件）`)],
    };
  }

  console.log(`   输入: ${sourceImage}`);

  const portraitPath = path.join(baseDir, "portrait.png");
  
  try {
    // 使用 sharp 读取图片元数据
    const metadata = await sharp(sourceImage).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    
    console.log(`   原图尺寸: ${width} x ${height}`);
    
    // 计算裁剪区域：中间上半 1/3
    // 高度取上面 1/3
    const cropHeight = Math.floor(height / 3);
    // 宽度取中间部分，保持 1:1
    const cropSize = Math.min(cropHeight, width);
    const cropLeft = Math.floor((width - cropSize) / 2);
    const cropTop = 0; // 从顶部开始
    
    console.log(`   裁剪区域: left=${cropLeft}, top=${cropTop}, size=${cropSize}x${cropSize}`);
    
    // 执行裁剪
    await sharp(sourceImage)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropSize,
        height: cropSize,
      })
      .toFile(portraitPath);
    
    console.log(`   ✅ 头像已保存: ${portraitPath}`);
    
    const portrait: GeneratedImage = {
      type: "portrait",
      url: portraitPath,
      localPath: portraitPath,
      hasBackground: true,
    };

    return {
      currentStage: "remove_bg",
      generatedImages: [portrait],
      messages: [new AIMessage(`[成功] 头像裁剪完成: ${portraitPath}`)],
    };
    
  } catch (error: any) {
    console.log(`   ❌ 裁剪失败: ${error.message}`);
    return {
      currentStage: "remove_bg",
      messages: [new AIMessage(`[跳过] 头像裁剪失败: ${error.message}`)],
    };
  }
}

/**
 * 抠图工具类型
 */
type RemoveBgTool = "rembg" | "removebg-api" | "simple-threshold";

// HF RMBG-1.4 模型的全局缓存，避免重复加载
let hfSegmenter: any = null;

/**
 * 使用 Hugging Face RMBG-1.4 进行高质量抠图 (推荐)
 * 效果优于 imgly，尤其适合动漫风格图片
 */
async function removeBackgroundWithHF(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const { pipeline, RawImage } = await import("@huggingface/transformers");
  
  // 设置 HF Token 通过环境变量
  if (CONFIG.huggingFace?.token && !process.env.HF_TOKEN) {
    process.env.HF_TOKEN = CONFIG.huggingFace.token;
  }
  
  // 懒加载模型 (只加载一次)
  if (!hfSegmenter) {
    console.log("      🧠 首次加载 RMBG-1.4 模型...");
    hfSegmenter = await pipeline("image-segmentation", "briaai/RMBG-1.4");
    console.log("      ✅ 模型加载完成");
  }
  
  // 执行分割，获取 mask
  const output = await hfSegmenter(inputPath);
  
  if (!Array.isArray(output) || output.length === 0 || !output[0].mask) {
    throw new Error("RMBG-1.4 未返回有效 mask");
  }
  
  const maskImage = output[0].mask as typeof RawImage.prototype;
  
  // 保存临时 mask
  const maskPath = outputPath.replace(".png", "_temp_mask.png");
  await maskImage.save(maskPath);
  
  // 使用 sharp 将 mask 应用到原图
  const originalMeta = await sharp(inputPath).metadata();
  const width = originalMeta.width!;
  const height = originalMeta.height!;
  
  // 调整 mask 尺寸与原图一致并转为灰度
  const maskResized = await sharp(maskPath)
    .resize(width, height)
    .grayscale()
    .raw()
    .toBuffer();
  
  // 读取原图 RGBA
  const originalRaw = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer();
  
  // 创建输出 buffer，使用 mask 作为 alpha
  const outputBuffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    outputBuffer[i * 4 + 0] = originalRaw[i * 4 + 0]; // R
    outputBuffer[i * 4 + 1] = originalRaw[i * 4 + 1]; // G
    outputBuffer[i * 4 + 2] = originalRaw[i * 4 + 2]; // B
    outputBuffer[i * 4 + 3] = maskResized[i];         // A (from mask)
  }
  
  await sharp(outputBuffer, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outputPath);
  
  // 删除临时 mask
  fs.unlinkSync(maskPath);
}

/**
 * 使用 @imgly/background-removal-node 进行高质量抠图 (备选)
 * 纯 TypeScript/Node.js 实现，使用 ONNX 神经网络
 */
async function removeBackgroundWithImgly(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const { removeBackground: imglyRemoveBg } = await import("@imgly/background-removal-node");
  
  // 读取图片为 Uint8Array
  const imageBuffer = fs.readFileSync(inputPath);
  const uint8Array = new Uint8Array(imageBuffer);
  
  // 创建 Blob
  const blob = new Blob([uint8Array], { type: "image/png" });
  
  // 调用 IMG.LY 抠图
  const resultBlob = await imglyRemoveBg(blob);
  
  // 转换 Blob 为 Buffer 并保存
  const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());
  fs.writeFileSync(outputPath, resultBuffer);
}

/**
 * 使用 Remove.bg API 进行抠图 (付费服务，高质量)
 */
async function removeBackgroundWithRemoveBgApi(
  inputPath: string,
  outputPath: string,
  apiKey: string
): Promise<void> {
  const FormData = (await import("form-data")).default;
  const formData = new FormData();
  formData.append("image_file", fs.createReadStream(inputPath));
  formData.append("size", "auto");
  
  const response = await axios.post("https://api.remove.bg/v1.0/removebg", formData, {
    headers: {
      ...formData.getHeaders(),
      "X-Api-Key": apiKey,
    },
    responseType: "arraybuffer",
  });
  
  fs.writeFileSync(outputPath, response.data);
}

/**
 * 简单的白色阈值抠图 (备用方案)
 */
async function removeWhiteBackgroundSimple(
  inputPath: string,
  outputPath: string,
  options: {
    threshold?: number;
    featherRadius?: number;
  } = {}
): Promise<void> {
  const { threshold = 240, featherRadius = 1 } = options;
  
  // 读取图片并获取原始像素数据
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const { width, height } = metadata;
  
  if (!width || !height) {
    throw new Error("无法获取图片尺寸");
  }
  
  // 获取 RGBA 原始数据
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // 处理每个像素
  const pixels = new Uint8Array(data);
  const channels = info.channels; // 应该是 4 (RGBA)
  
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    
    // 检测是否为白色或接近白色
    if (r >= threshold && g >= threshold && b >= threshold) {
      // 计算透明度：越接近纯白越透明
      const minChannel = Math.min(r, g, b);
      const whiteness = (r + g + b) / 3;
      
      if (whiteness >= 250) {
        // 纯白，完全透明
        pixels[i + 3] = 0;
      } else if (whiteness >= threshold) {
        // 接近白色，半透明（用于边缘过渡）
        const alpha = Math.round(255 * (1 - (whiteness - threshold) / (255 - threshold)));
        pixels[i + 3] = Math.min(pixels[i + 3], alpha);
      }
    }
  }
  
  // 创建新图片并保存
  await sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: channels as 4,
    },
  })
    .png()
    .toFile(outputPath);
}

/**
 * 智能选择抠图方法
 * 优先级: HF RMBG-1.4 > imgly > Remove.bg API > 简单阈值
 */
async function removeBackground(
  inputPath: string,
  outputPath: string,
  tool: RemoveBgTool = "rembg"
): Promise<{ success: boolean; tool: string; error?: string }> {
  // 1. 尝试 HF RMBG-1.4 (最佳效果，动漫风格优化)
  try {
    await removeBackgroundWithHF(inputPath, outputPath);
    return { success: true, tool: "HF RMBG-1.4" };
  } catch (error: any) {
    console.log(`      ⚠️ HF RMBG-1.4 失败: ${error.message}`);
  }
  
  // 2. 尝试 IMG.LY (备选，纯 TypeScript 深度学习)
  try {
    await removeBackgroundWithImgly(inputPath, outputPath);
    return { success: true, tool: "imgly" };
  } catch (error: any) {
    console.log(`      ⚠️ IMG.LY 失败: ${error.message}`);
  }
  
  // 3. 尝试 Remove.bg API (付费但高质量)
  if (CONFIG.backgroundRemoval.apiKey) {
    try {
      await removeBackgroundWithRemoveBgApi(inputPath, outputPath, CONFIG.backgroundRemoval.apiKey);
      return { success: true, tool: "Remove.bg API" };
    } catch (error: any) {
      console.log(`      ⚠️ Remove.bg API 失败: ${error.message}`);
    }
  }
  
  // 3. 回退到简单阈值方法
  console.log(`      ↪ 回退到简单阈值方法...`);
  try {
    await removeWhiteBackgroundSimple(inputPath, outputPath, {
      threshold: 245,
      featherRadius: 1,
    });
    return { success: true, tool: "simple-threshold" };
  } catch (error: any) {
    return { success: false, tool: "none", error: error.message };
  }
}

/**
 * 抠图节点
 * 移除背景，输出透明 PNG
 * 
 * 推荐安装 rembg 获得最佳效果:
 *   pip install rembg[gpu]  # GPU 加速
 *   pip install rembg       # CPU 版本
 */
async function removeBgNode(
  state: CharacterSpriteStateType
): Promise<Partial<CharacterSpriteStateType>> {
  console.log("\n🔲 [Step 5] 抠图 (高质量背景移除)...");

  const characterName = state.characterInput.name || "character";
  const { baseDir, nobgDir } = ensureCharacterDirs(characterName, state.outputDir);

  // 收集所有需要抠图的图像
  const imagesToProcess = state.generatedImages.filter(
    (img) => img.hasBackground && img.localPath && fs.existsSync(img.localPath)
  );

  console.log(`   需要抠图的图像数量: ${imagesToProcess.length}`);
  console.log(`   输出目录: ${nobgDir}`);
  console.log(`   抠图工具: HF RMBG-1.4 (Hugging Face Transformers)`);

  const processedImages: GeneratedImage[] = [];
  let successCount = 0;
  let failCount = 0;
  const toolsUsed = new Set<string>();

  for (const img of imagesToProcess) {
    const originalName = path.basename(img.localPath || "image.png");
    const nobgPath = path.join(nobgDir, originalName);
    
    console.log(`   🔄 处理: ${originalName}`);
    const result = await removeBackground(img.localPath!, nobgPath, "rembg");
    
    if (result.success) {
      processedImages.push({
        ...img,
        url: nobgPath,
        localPath: nobgPath,
        hasBackground: false,
      });
      successCount++;
      toolsUsed.add(result.tool);
      console.log(`      ✅ 完成 (${result.tool}): ${nobgPath}`);
    } else {
      failCount++;
      console.log(`      ❌ 失败: ${originalName} - ${result.error}`);
    }
  }

  const toolsList = Array.from(toolsUsed).join(", ") || "无";
  console.log(`   📊 抠图结果: 成功 ${successCount} 张, 失败 ${failCount} 张`);
  console.log(`   🔧 使用工具: ${toolsList}`);

  return {
    currentStage: "completed",
    generatedImages: [...state.generatedImages, ...processedImages],
    messages: [new AIMessage(`[成功] 抠图完成 (${toolsList})，输出到 ${nobgDir}`)],
  };
}

/**
 * 输出节点 - 整理最终结果
 */
async function outputNode(
  state: CharacterSpriteStateType
): Promise<Partial<CharacterSpriteStateType>> {
  console.log("\n📋 [输出] 整理最终结果...");

  const characterName = state.characterInput.name || "character";
  const characterDir = getCharacterDir(characterName, state.outputDir);
  const { baseDir } = ensureCharacterDirs(characterName, state.outputDir);

  // 按类型分类图像
  const sprites = state.generatedImages.filter(img => img.type === "sprite");
  const expressions = state.generatedImages.filter(img => img.type === "expression");
  const portraits = state.generatedImages.filter(img => img.type === "portrait");
  const nobgImages = state.generatedImages.filter(img => !img.hasBackground);

  // 为所有图像资产写入可追溯元数据（sidecar）
  const generatedAt = new Date().toISOString();
  const uniqueLocalPaths = Array.from(
    new Set(
      state.generatedImages
        .map(img => img.localPath)
        .filter((p): p is string => Boolean(p))
    )
  );

  for (const localPath of uniqueLocalPaths) {
    const img = state.generatedImages.find(item => item.localPath === localPath);
    if (!img || !fs.existsSync(localPath)) continue;

    const filename = path.basename(localPath);
    const isNoBg = localPath.includes(`${path.sep}nobg${path.sep}`);
    const parentCandidate = isNoBg ? path.join(baseDir, filename) : null;

    const metadata: Record<string, unknown> = {
      schemaVersion: "1.0.0",
      assetType: "character_image",
      characterName: state.characterInput.name,
      imageType: img.type,
      expression: img.expression || null,
      generatedAt,
      outputPath: localPath,
      outputSha256: fileSha256(localPath),
      generator: {
        agent: "character-sprite-agent",
        provider: {
          sprite: "midjourney",
          polish: "gemini-3-pro-image-preview",
          expression: "gemini-3-pro-image-preview",
          removeBackground: "HF RMBG-1.4 / fallback tools",
        },
        taskIds: state.taskIds,
      },
      prompts: {
        midjourneySprite: state.mjPrompt || null,
        geminiPolish: state.polishPrompt || null,
        geminiExpressionSheet: state.expressionPrompt || null,
      },
      promptContracts: {
        sprite: {
          id: getImagePromptContractId("sprite"),
          version: PROMPT_CONTRACT_VERSION,
        },
      },
      seed: state.randomSeed || null,
      inputs: {
        characterInput: state.characterInput,
      },
      derivation: {
        sourcePath: parentCandidate && fs.existsSync(parentCandidate) ? parentCandidate : null,
        sourceSha256: parentCandidate && fs.existsSync(parentCandidate) ? fileSha256(parentCandidate) : null,
        operation: isNoBg
          ? "background_removal"
          : img.type === "portrait"
            ? "portrait_crop"
            : img.type === "expression" && img.expression
              ? "expression_sheet_crop"
              : "model_generation",
      },
    };

    writeImageMetadata(localPath, metadata);
  }

  const summary = `
╔════════════════════════════════════════════════════════════╗
║           角色立绘生成流水线 - 完成报告                      ║
╚════════════════════════════════════════════════════════════╝

📝 角色信息:
   名称: ${state.characterInput.name}
   世界观: ${state.characterInput.worldSetting}
   外貌: ${state.characterInput.appearance}

📊 流水线状态: ${state.currentStage === "completed" ? "✅ 完成" : state.currentStage === "failed" ? "❌ 失败" : state.currentStage}
${state.error ? `\n⚠️ 错误信息: ${state.error}` : ""}

📁 角色目录: ${characterDir}
   结构:
   └── ${characterName}/
       ├── base_sprite.png      # 基础立绘 (2:3)
       ├── expression_sheet.png # 表情表 (2x2)
       ├── portrait.png         # 头像 (1:1)
       └── nobg/                 # 抠图版本
           ├── base_sprite.png
           ├── expression_sheet.png
           └── portrait.png

🎨 生成的资源:

   1️⃣ 基础立绘 (MJ 2:3 膝盖以上):
${sprites.length > 0 
  ? sprites.map(img => `      ✅ ${img.localPath}`).join("\n")
  : "      ❌ (未生成)"}

   2️⃣ 表情表 (Gemini 2x2 四种表情):
${expressions.length > 0
  ? expressions.map(img => `      ✅ ${img.localPath}`).join("\n")
  : state.expressionSheetUrl 
    ? `      ✅ ${state.expressionSheetUrl}`
    : "      ❌ (未生成)"}

   3️⃣ 头像 (裁剪肩部以上 1:1):
${portraits.length > 0
  ? portraits.map(img => `      ✅ ${img.localPath}`).join("\n")
  : "      ⏳ (待实现)"}

   4️⃣ 抠图版本 (透明背景):
${nobgImages.length > 0
  ? nobgImages.map(img => `      ✅ ${img.localPath}`).join("\n")
  : "      ⏳ (待实现)"}

════════════════════════════════════════════════════════════
`;

  console.log(summary);

  return {
    messages: [new AIMessage(summary)],
  };
}

// ============================================
// 6. 路由函数
// ============================================

/**
 * 检查当前阶段并路由到下一个节点
 */
function routeByStage(
  state: CharacterSpriteStateType
): "mj_sprite" | "gemini_polish" | "gemini_expression" | "crop_portrait" | "remove_bg" | "output" {
  switch (state.currentStage) {
    case "init":
      return "mj_sprite";
    case "mj_sprite":
      return "gemini_polish";
    case "gemini_polish":
      return "gemini_expression";
    case "gemini_expression":
      return "crop_portrait";
    case "crop_portrait":
      return "remove_bg";
    case "remove_bg":
    case "completed":
    case "failed":
    default:
      return "output";
  }
}

/**
 * 检查是否失败
 */
function checkFailed(state: CharacterSpriteStateType): "continue" | "output" {
  if (state.currentStage === "failed" || state.error) {
    return "output";
  }
  return "continue";
}

// ============================================
// 7. 构建 Graph
// ============================================

export function buildCharacterSpriteGraph() {
  const workflow = new StateGraph(CharacterSpriteState)
    // 添加节点
    .addNode("init", initNode)
    .addNode("mj_sprite", mjSpriteNode)
    .addNode("gemini_polish", geminiPolishNode)
    .addNode("gemini_expression", geminiExpressionNode)
    .addNode("crop_portrait", cropPortraitNode)
    .addNode("remove_bg", removeBgNode)
    .addNode("output", outputNode)

    // 添加边
    .addEdge(START, "init")

    // init -> mj_sprite
    .addEdge("init", "mj_sprite")

    // mj_sprite -> check -> gemini_polish or output
    .addConditionalEdges("mj_sprite", checkFailed, {
      continue: "gemini_polish",
      output: "output",
    })

    // gemini_polish -> gemini_expression
    .addEdge("gemini_polish", "gemini_expression")

    // gemini_expression -> check -> crop_portrait or output
    .addConditionalEdges("gemini_expression", checkFailed, {
      continue: "crop_portrait",
      output: "output",
    })

    // crop_portrait -> remove_bg
    .addEdge("crop_portrait", "remove_bg")

    // remove_bg -> output
    .addEdge("remove_bg", "output")

    // output -> END
    .addEdge("output", END);

  return workflow.compile();
}

// ============================================
// 8. 导出和测试
// ============================================

export { CharacterSpriteState, CharacterInput, GeneratedImage, ExpressionType };

/**
 * 运行角色立绘生成流水线
 */
export interface CharacterSpriteResult {
  success: boolean;
  state?: CharacterSpriteStateType;
  error?: string;
}

export interface CharacterSpriteOptions {
  /** 角色立绘输出目录 (默认 assets/characters/) */
  outputDir?: string;
}

export async function generateCharacterSprite(
  input: CharacterInput,
  options?: CharacterSpriteOptions
): Promise<CharacterSpriteResult> {
  try {
    // 输出目录通过 state 传递，避免并行冲突
    const outputDir = options?.outputDir || DEFAULT_CHARACTERS_DIR;
    console.log(`   📁 角色输出目录: ${outputDir}`);
    
    const graph = buildCharacterSpriteGraph();

    const result = await graph.invoke({
      characterInput: input,
      outputDir: outputDir,  // 通过 state 传递，不再使用全局变量
    });

    const success = result.currentStage === "completed";
    
    return {
      success,
      state: result,
      error: success ? undefined : result.error || "未知错误",
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

// ============================================
// 9. 测试入口
// ============================================

async function runTest() {
  console.log("=".repeat(60));
  console.log("🎮 角色立绘生成流水线 Agent - 测试");
  console.log("=".repeat(60));

  console.log(`\n📁 角色资源目录: ${DEFAULT_CHARACTERS_DIR}`);
  console.log(`📄 提示词目录: ${PROMPTS_DIR}`);

  const testCharacter: CharacterInput = {
    name: "艾莉丝",
    worldSetting: "fantasy medieval kingdom, magical academy",
    appearance:
      "young female mage, long silver hair, purple eyes, gentle expression",
    personality: "kind, intelligent, slightly shy",
    outfit:
      "blue and white mage robes with gold trim, holding a wooden staff",
  };

  console.log("\n📝 测试角色:");
  console.log(JSON.stringify(testCharacter, null, 2));

  try {
    const result = await generateCharacterSprite(testCharacter);

    console.log("\n" + "=".repeat(60));
    console.log("✅ 流水线执行完成!");
    console.log("=".repeat(60));

    console.log("\n成功:", result.success);
    
    if (result.state) {
      console.log("最终状态:", result.state.currentStage);
      console.log("生成图像数量:", result.state.generatedImages.length);
      
      if (result.state.generatedImages.length > 0) {
        console.log("\n生成的图片:");
        result.state.generatedImages.forEach((img: GeneratedImage, i: number) => {
          console.log(`  ${i + 1}. [${img.type}] ${img.localPath || img.url}`);
        });
      }
    }

    if (result.error) {
      console.log("\n错误:", result.error);
    }
  } catch (error: any) {
    console.error("\n❌ 测试失败:", error.message);
  }
}

// ESM 模块直接运行检测
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runTest().catch(console.error);
}
