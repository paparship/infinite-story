/**
 * 完整生成工作流
 * 
 * 流程：
 * 1. 偏好选择节点
 * 2. 提示词装配节点
 * 3. 第一章生成节点
 * 4. 并行执行：
 *    - Node 2A: 第二章分支生成
 *    - Node 2B: 场景角色描述提取
 * 
 * 使用 LangGraph 编排
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// 类型导入
import { 
  PlayerPreferences, 
  EffectType, 
  AVAILABLE_EFFECTS,
} from "./types/player-preferences.js";

// 服务导入
import {
  generatePlayerId,
  createDefaultPreferences,
  savePreferences,
  getActivePlayer,
} from "./services/preference-storage.js";

import {
  buildTemplateVariables,
} from "./services/prompt-assembler.js";
import { compilePrompt } from "./services/prompt-compiler.js";
import { lintScript } from "../core/ScriptLinter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ 配置 ============

const configPath = path.join(__dirname, "config/api-config.json");
const API_CONFIG = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Gemini API Key（优先使用，避免 Vertex AI 限流）
const GEMINI_API_KEY = API_CONFIG["google-chat"]?.api_key || "";

// Vertex AI 配置（备用）
const VERTEX_CONFIG = {
  project: API_CONFIG["vertex-chat"].api_key,
  location: API_CONFIG["vertex-chat"].location,
};

const CREDENTIALS_PATH = "/path/to/local-resource";
process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDENTIALS_PATH;

// 模型配置
const TEXT_MODEL_GEMINI = "gemini-3-flash-preview";  // Gemini API 使用的模型
const TEXT_MODEL_VERTEX = "gemini-3-pro-preview";  // Vertex AI 使用的模型
const USE_GEMINI_API = false;  // 强制使用 Vertex AI（Gemini API 有兼容性问题）

// 创建 LLM 模型的工厂函数
function createTextModel(options: { temperature?: number; maxOutputTokens?: number } = {}) {
  const { temperature = 0.8, maxOutputTokens = 8192 } = options;
  
  if (USE_GEMINI_API) {
    console.log(`   📡 使用 Gemini API (${TEXT_MODEL_GEMINI})`);
    return new ChatGoogleGenerativeAI({
      model: TEXT_MODEL_GEMINI,
      apiKey: GEMINI_API_KEY,
      temperature,
      maxOutputTokens,
    });
  }
  
  console.log(`   📡 使用 Vertex AI (${TEXT_MODEL_VERTEX})`);
  return new ChatVertexAI({
    model: TEXT_MODEL_VERTEX,
    location: VERTEX_CONFIG.location,
    temperature,
    maxOutputTokens,
  });
}

// 兼容旧代码的模型名称
const TEXT_MODEL = USE_GEMINI_API ? TEXT_MODEL_GEMINI : TEXT_MODEL_VERTEX;

// ============ 工作流状态定义 ============

const WorkflowState = Annotation.Root({
  // 随机种子（用于所有文本模型）
  randomSeed: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  // 玩家偏好
  preferences: Annotation<PlayerPreferences | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),
  
  // 装配后的提示词（第一章）
  assembledPrompt: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  
  // 游戏标题（从第一章提取）
  gameTitle: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  
  // 第一章剧本
  chapter1Script: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  
  // 第一章检测到的角色
  chapter1Characters: Annotation<string[]>({
    reducer: (_, newVal) => newVal,
    default: () => [],
  }),
  
  // 第二章分支剧本
  chapter2Branches: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  
  // 第一章角色描述（世界观+各角色）
  worldSetting: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  characterA: Annotation<string>({  // 角色A完整描述（世界观+角色A）
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  characterB: Annotation<string>({  // 角色B完整描述（世界观+角色B）
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  characterC: Annotation<string>({  // 角色C完整描述（世界观+角色C）
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  characterNames: Annotation<{ a: string; b: string; c: string }>({
    reducer: (_, newVal) => newVal,
    default: () => ({ a: "", b: "", c: "" }),
  }),
  
  // 各章节的 settings
  settings1: Annotation<string>({  // 第一章后
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  settings2A: Annotation<string>({ // 第二章路线A后
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  settings2B: Annotation<string>({ // 第二章路线B后
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  settings2C: Annotation<string>({ // 第二章路线C后
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  settings3A: Annotation<string>({ // 第三章路线A后
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  settings3B: Annotation<string>({ // 第三章路线B后
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  settings3C: Annotation<string>({ // 第三章路线C后
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  
  // 分割后的第二章路线
  chapter2RouteA: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  chapter2RouteB: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  chapter2RouteC: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  
  // 第三章结局
  chapter3EndingA: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  chapter3EndingB: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  chapter3EndingC: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  
  // 错误信息
  error: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),
  
  // 翻译目标地区
  targetRegion: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "中国",  // 默认中文，跳过翻译
  }),
  
  // 翻译后的内容
  translatedChapter1: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  translatedRouteA: Annotation<{ chapter2: string; chapter3: string }>({
    reducer: (_, newVal) => newVal,
    default: () => ({ chapter2: "", chapter3: "" }),
  }),
  translatedRouteB: Annotation<{ chapter2: string; chapter3: string }>({
    reducer: (_, newVal) => newVal,
    default: () => ({ chapter2: "", chapter3: "" }),
  }),
  translatedRouteC: Annotation<{ chapter2: string; chapter3: string }>({
    reducer: (_, newVal) => newVal,
    default: () => ({ chapter2: "", chapter3: "" }),
  }),
  
  // 各节点成功状态
  node1Success: Annotation<boolean>({
    reducer: (_, newVal) => newVal,
    default: () => false,
  }),
  node2aSuccess: Annotation<boolean>({
    reducer: (_, newVal) => newVal,
    default: () => false,
  }),
  node2bSuccess: Annotation<boolean>({
    reducer: (_, newVal) => newVal,
    default: () => false,
  }),
  node3Success: Annotation<boolean>({
    reducer: (_, newVal) => newVal,
    default: () => false,
  }),
  translationSuccess: Annotation<boolean>({
    reducer: (_, newVal) => newVal,
    default: () => false,
  }),
});

type WorkflowStateType = typeof WorkflowState.State;

// ============ 节点 1: 偏好选择 ============

async function preferenceSelectionNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("🎨 节点 1.1: 偏好选择");
  console.log("=".repeat(60));
  
  try {
    // 从命令行参数获取特效设置（优先级最高）
    // 支持格式: --effect=sakura 或 --effect sakura
    let cliEffect: EffectType | null = null;
    const effectArg = process.argv.find(a => a.startsWith("--effect="));
    if (effectArg) {
      const effectName = effectArg.split("=")[1] as EffectType;
      if (AVAILABLE_EFFECTS[effectName]) {
        cliEffect = effectName;
      }
    } else {
      const effectIndex = process.argv.indexOf("--effect");
      if (effectIndex !== -1 && process.argv[effectIndex + 1]) {
        const effectName = process.argv[effectIndex + 1] as EffectType;
        if (AVAILABLE_EFFECTS[effectName]) {
          cliEffect = effectName;
        }
      }
    }
    
    let preferences = getActivePlayer();
    
    if (preferences) {
      // 如果命令行指定了特效，覆盖已存在的偏好
      if (cliEffect) {
        preferences.visual.preferredEffect = cliEffect;
        preferences.visual.preferredSeason = AVAILABLE_EFFECTS[cliEffect].season as any;
        console.log(`\n📋 使用已存在的玩家偏好 (特效被命令行覆盖):`);
        console.log(`   玩家ID: ${preferences.playerId}`);
        console.log(`   偏好特效: ${cliEffect} (来自 --effect 参数)`);
      } else {
        console.log(`\n📋 使用已存在的玩家偏好:`);
        console.log(`   玩家ID: ${preferences.playerId}`);
        console.log(`   偏好特效: ${preferences.visual.preferredEffect}`);
      }
      return { preferences, randomSeed: state.randomSeed || createRandomSeed() };
    }
    
    // 没有已存在偏好，创建新的
    const selectedEffect = cliEffect || "sakura";
    const selectedInfo = AVAILABLE_EFFECTS[selectedEffect];
    console.log(`\n🎨 使用特效: ${selectedInfo.name} (@effect ${selectedEffect})`);
    
    const playerId = generatePlayerId();
    preferences = createDefaultPreferences(playerId);
    preferences.visual.preferredEffect = selectedEffect;
    preferences.visual.preferredSeason = selectedInfo.season as any;
    
    savePreferences(preferences);
    
    return { preferences, randomSeed: state.randomSeed || createRandomSeed() };
    
  } catch (error: any) {
    console.error(`\n❌ 偏好选择失败: ${error.message}`);
    return { error: `偏好选择失败: ${error.message}` };
  }
}

// ============ 节点 1.2: 提示词装配 ============

async function promptAssemblyNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("📝 节点 1.2: 提示词装配");
  console.log("=".repeat(60));
  
  if (!state.preferences) {
    return { error: "缺少玩家偏好" };
  }
  
  try {
    const variables = buildTemplateVariables(state.preferences);
    const assembledPrompt = appendSeedNote(
      compileNarrativePrompt("chapter1", variables),
      state.randomSeed
    );
    
    console.log(`\n✅ 装配完成`);
    console.log(`   特效: ${variables.PREFERRED_EFFECT}`);
    
    return { assembledPrompt };
    
  } catch (error: any) {
    return { error: `提示词装配失败: ${error.message}` };
  }
}

function buildPromptVariables(
  preferences: PlayerPreferences,
  characterNames?: { a: string; b: string; c: string },
  characterName?: string,
  characterProfiles?: { a: string; b: string; c: string }  // 角色设定
): Record<string, string> {
  const variables = buildTemplateVariables(preferences);
  if (characterNames) {
    variables.CHARACTER_A = characterNames.a;
    variables.CHARACTER_B = characterNames.b;
    variables.CHARACTER_C = characterNames.c;
  }
  if (characterName) {
    variables.CHARACTER_NAME = characterName;
  }
  // 角色设定（用于保持一致性）
  if (characterProfiles) {
    variables.CHARACTER_A_PROFILE = characterProfiles.a || "";
    variables.CHARACTER_B_PROFILE = characterProfiles.b || "";
    variables.CHARACTER_C_PROFILE = characterProfiles.c || "";
  }
  return variables as Record<string, string>;
}

function createRandomSeed(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function appendSeedNote(prompt: string, seed?: string): string {
  const safeSeed = seed || createRandomSeed();
  return `${prompt}\n\n[RandomSeed] ${safeSeed}\n请确保输出具有随机性，但保持格式严格一致。`;
}

function compileTextPrompt(
  contractId: string,
  variables: Record<string, string | undefined>
): string {
  return compilePrompt(contractId, variables).renderedPrompt;
}

function getPromptBranch(): "v1" | "v2" {
  return process.env.PROMPT_BRANCH === "v2" ? "v2" : "v1";
}

function withCommonNarrativeSpec(promptBody: string): string {
  if (getPromptBranch() !== "v2") return promptBody;
  const commonSpec = compileTextPrompt("text_v2/script_format", {});
  return `${commonSpec}\n\n以下是本章节专属要求：\n${promptBody}`;
}

function compileNarrativePrompt(
  stage: "chapter1" | "chapter2" | "chapter3",
  variables: Record<string, string | undefined>
): string {
  if (getPromptBranch() === "v2") {
    if (stage === "chapter1") {
      return withCommonNarrativeSpec(compileTextPrompt("text_v2/chapter1_generation", variables));
    }
    if (stage === "chapter2") {
      return withCommonNarrativeSpec(compileTextPrompt("text_v2/chapter2_branches", variables));
    }
    return withCommonNarrativeSpec(compileTextPrompt("text_v2/chapter3_ending", variables));
  }

  if (stage === "chapter1") {
    return compileTextPrompt("text/chapter1_generation_v2", variables);
  }
  if (stage === "chapter2") {
    return compileTextPrompt("text/chapter2_branches", variables);
  }
  return compileTextPrompt("text/chapter3_ending", variables);
}

function compileExtractionPrompt(
  stage: "extract_settings" | "extract_characters" | "translate",
  variables: Record<string, string | undefined>
): string {
  if (getPromptBranch() === "v2") {
    if (stage === "extract_settings") return compileTextPrompt("text_v2/extract_settings", variables);
    if (stage === "extract_characters") return compileTextPrompt("text_v2/extract_characters", variables);
    return compileTextPrompt("text_v2/translate", variables);
  }

  if (stage === "extract_settings") return compileTextPrompt("text/extract_settings", variables);
  if (stage === "extract_characters") return compileTextPrompt("text/extract_characters", variables);
  return compileTextPrompt("text/translate", variables);
}

function getScriptSpecMode(): "v1_compat" | "v2_strict" {
  return process.env.SCRIPT_SPEC_MODE === "strict_v2" ? "v2_strict" : "v1_compat";
}

function lintGeneratedScript(script: string, label: string): { ok: boolean; normalized: string; summary: string } {
  const specMode = getScriptSpecMode();
  const lint = lintScript(script, specMode);
  if (lint.ok) {
    return { ok: true, normalized: lint.normalizedText, summary: "" };
  }

  const topErrors = lint.errors.slice(0, 3).map(e => `[L${e.line}] ${e.code}: ${e.message}`);
  const summary = `${label} lint 失败:\n${topErrors.join("\n")}`;

  // 双轨策略：compat 默认不阻断旧链路，strict 才阻断
  if (specMode === "v1_compat") {
    console.warn(`⚠️ ${summary}`);
    return { ok: true, normalized: lint.normalizedText, summary };
  }

  return { ok: false, normalized: lint.normalizedText, summary };
}

// ============ 节点 1.3: 第一章生成 ============

async function chapter1GenerationNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("📖 节点 1.3: 第一章生成");
  console.log("=".repeat(60));
  
  if (!state.assembledPrompt) {
    return { error: "缺少装配后的提示词" };
  }
  
  // 重试配置（针对 API 限流）
  const MAX_RETRIES = 5;
  const BASE_DELAY = 30000; // 基础等待 30 秒
  
  console.log(`\n🤖 使用模型: ${TEXT_MODEL}`);
  
  const model = createTextModel({ temperature: 0.8, maxOutputTokens: 8192 });
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n⏳ 正在生成第一章剧本...${attempt > 1 ? ` (第 ${attempt} 次尝试)` : ''}`);
      const startTime = Date.now();
      
      const response = await model.invoke([
        new SystemMessage(state.assembledPrompt),
        new HumanMessage("请根据上述要求，生成完整的第一章剧本。"),
      ]);
      
      const chapter1Script = response.content as string;
      const lint = lintGeneratedScript(chapter1Script, "第一章");
      if (!lint.ok) {
        throw new Error(lint.summary);
      }
      const endTime = Date.now();
      
      console.log(`\n✅ 第一章生成完成!`);
      console.log(`   耗时: ${((endTime - startTime) / 1000).toFixed(1)}s`);
      console.log(`   长度: ${chapter1Script.length} 字符`);
      
      // 提取游戏标题
      const titleMatch = chapter1Script.match(/@game_title\s*"([^"]+)"/);
      const gameTitle = titleMatch ? titleMatch[1].trim() : "";
      if (gameTitle) {
        console.log(`   游戏标题: ${gameTitle}`);
      }
      
      // 提取角色
      const characterMatches = chapter1Script.match(/^([^\s：「」\n]{2,6})：「/gm);
      const chapter1Characters = [...new Set(
        characterMatches?.map(m => m.replace(/：「$/, "").replace(/^【对话】/, "").trim()) || []
      )].filter(c => c.length >= 2 && c.length <= 6);
      
      console.log(`   角色: ${chapter1Characters.join(", ")}`);
      
      return {
        gameTitle,
        chapter1Script: lint.normalized,
        chapter1Characters,
        node1Success: true,
      };
      
    } catch (error: any) {
      const errorMsg = error?.message || String(error) || "未知错误";
      const isRateLimit = errorMsg.includes("429") || errorMsg.includes("Resource exhausted") || errorMsg.includes("rate");
      
      if (isRateLimit && attempt < MAX_RETRIES) {
        // 指数退避：30s, 60s, 120s, 240s
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`\n⚠️ API 限流，${delay / 1000} 秒后重试 (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      console.error(`\n❌ 第一章生成失败: ${errorMsg}`);
      return { error: `第一章生成失败: ${errorMsg}`, node1Success: false };
    }
  }
  
  return { error: "第一章生成失败: 超过最大重试次数", node1Success: false };
}

// ============ 节点 2A: 第二章分支生成 ============

async function chapter2BranchesNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("📖 节点 2A: 第二章分支生成");
  console.log("=".repeat(60));
  
  if (!state.chapter1Script || !state.preferences) {
    return { error: "缺少第一章剧本或玩家偏好", node2aSuccess: false };
  }
  
  // 重试配置（针对 API 限流）
  const MAX_RETRIES = 5;
  const BASE_DELAY = 30000; // 基础等待 30 秒
  
  // 加载并装配提示词
  // 替换变量（包含角色设定）
  const characterProfiles = {
    a: state.characterA || "",
    b: state.characterB || "",
    c: state.characterC || "",
  };
  const variables = buildPromptVariables(state.preferences, state.characterNames, undefined, characterProfiles);
  const template = appendSeedNote(
    compileNarrativePrompt("chapter2", {
      ...variables,
      CHAPTER1_SCRIPT: state.chapter1Script,
    }),
    state.randomSeed
  );
  
  console.log(`\n🤖 使用模型: ${TEXT_MODEL}`);
  
  const model = createTextModel({ temperature: 0.8, maxOutputTokens: 16384 });
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n⏳ 正在生成第二章三条路线...${attempt > 1 ? ` (第 ${attempt} 次尝试)` : ''}`);
      const startTime = Date.now();
      
      const response = await model.invoke([
        new SystemMessage(template),
        new HumanMessage("请生成完整的第二章三条角色路线剧本，每条路线都要有完整的选项和结局。"),
      ]);
      
      const chapter2Branches = response.content as string;
      const endTime = Date.now();
      
      console.log(`\n✅ 第二章分支生成完成!`);
      console.log(`   耗时: ${((endTime - startTime) / 1000).toFixed(1)}s`);
      console.log(`   长度: ${chapter2Branches.length} 字符`);
      
      // 统计路线标记
      const endRouteCount = (chapter2Branches.match(/@end_route/g) || []).length;
      const routeHeaderCount = (chapter2Branches.match(/===\s*路线[ABC]/g) || []).length;
      console.log(`   @end_route 标记: ${endRouteCount} 个`);
      console.log(`   路线头标记: ${routeHeaderCount} 个`);
      
      return {
        chapter2Branches,
        node2aSuccess: true,
      };
      
    } catch (error: any) {
      const errorMsg = error?.message || String(error) || "未知错误";
      const isRateLimit = errorMsg.includes("429") || errorMsg.includes("Resource exhausted") || errorMsg.includes("rate");
      
      if (isRateLimit && attempt < MAX_RETRIES) {
        // 指数退避：30s, 60s, 120s, 240s
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`\n⚠️ API 限流，${delay / 1000} 秒后重试 (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      console.error(`\n❌ 第二章分支生成失败: ${errorMsg}`);
      return { error: `第二章分支生成失败: ${errorMsg}`, node2aSuccess: false };
    }
  }
  
  return { error: "第二章分支生成失败: 超过最大重试次数", node2aSuccess: false };
}

// ============ 通用 settings 提取函数 ============

async function extractSettings(content: string, label: string, seed?: string, characterProfile?: string): Promise<string> {
  if (!content || content.trim().length === 0) {
    console.warn(`   ⚠️ ${label} 内容为空，跳过提取`);
    return "";
  }
  
  const profileSection = characterProfile
    ? `=== 角色设定参考（外貌配饰必须一致） ===\n${characterProfile}`
    : "";
  let prompt = compileExtractionPrompt("extract_settings", {
    CHAPTER1_SCRIPT: content,
    SCRIPT_CONTENT: content,
    CHARACTER_PROFILE_SECTION: profileSection,
  });
  prompt = appendSeedNote(prompt, seed);
  
  // 重试配置
  const MAX_RETRIES = 3;
  const BASE_DELAY = 10000; // 10 秒
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = createTextModel({ temperature: 0.3, maxOutputTokens: 4096 });
      
      console.log(`   ⏳ 提取 ${label} 的 settings...${attempt > 1 ? ` (第 ${attempt} 次尝试)` : ''}`);
      const startTime = Date.now();
      
      const response = await model.invoke([
        new HumanMessage(prompt),
      ]);
      
      // 安全提取响应内容
      let result = "";
      if (response && response.content) {
        if (typeof response.content === "string") {
          result = response.content;
        } else if (Array.isArray(response.content)) {
          // 处理多部分响应
          result = response.content.map((part: any) => 
            typeof part === "string" ? part : part?.text || ""
          ).join("");
        }
      }
      
      const endTime = Date.now();
      
      // 检查是否为空响应（视为失败，需要重试）
      if (!result || result.trim().length < 10) {
        throw new Error(`响应内容过短或为空 (${result.length} 字符)`);
      }
      
      console.log(`   ✅ ${label} settings 完成 (${((endTime - startTime) / 1000).toFixed(1)}s, ${result.length} 字符)`);
      
      return result;
      
    } catch (error: unknown) {
      // 安全获取错误信息
      let errorMsg = "未知错误";
      if (error instanceof Error) {
        errorMsg = error.message;
      } else if (error && typeof error === "object" && "message" in error) {
        errorMsg = String((error as any).message);
      } else if (error) {
        errorMsg = String(error);
      }
      
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY * attempt;
        console.warn(`   ⚠️ ${label} settings 提取失败: ${errorMsg}，${delay / 1000}秒后重试 (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      console.error(`   ❌ ${label} settings 提取失败（已重试${MAX_RETRIES}次）: ${errorMsg}`);
      // 返回空字符串而不是抛出错误，让流程继续
      return "";
    }
  }
  
  return "";
}

// ============ 节点 2B: 第一章 settings 提取 ============

async function extractSettings1Node(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("🎨 节点 2B: 第一章 settings 提取");
  console.log("=".repeat(60));
  
  if (!state.chapter1Script) {
    return { error: "缺少第一章剧本", node2bSuccess: false };
  }
  
  try {
    const settings1 = await extractSettings(state.chapter1Script, "第一章", state.randomSeed);
    
    return {
      settings1,
      node2bSuccess: true,
    };
    
  } catch (error: any) {
    console.error(`\n❌ 提取失败: ${error.message}`);
    return { error: `提取失败: ${error.message}`, node2bSuccess: false };
  }
}

// ============ 节点: 第一章角色描述提取 ============

async function extractCharactersNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("👥 节点: 角色描述提取");
  console.log("=".repeat(60));
  
  if (!state.chapter1Script) {
    return { error: "缺少第一章剧本" };
  }
  
  try {
    let prompt = compileExtractionPrompt("extract_characters", {
      CHAPTER1_SCRIPT: state.chapter1Script,
      SCRIPT_CONTENT: state.chapter1Script,
    });
    prompt = appendSeedNote(prompt, state.randomSeed);
    
    const model = createTextModel({ temperature: 0.3, maxOutputTokens: 8192 });
    
    console.log("\n⏳ 正在提取世界观和角色描述...");
    const startTime = Date.now();
    
    const response = await model.invoke([
      new HumanMessage(prompt),
    ]);
    
    const fullContent = response.content as string;
    const endTime = Date.now();
    
    console.log(`\n✅ 提取完成 (${((endTime - startTime) / 1000).toFixed(1)}s, ${fullContent.length} 字符)`);
    
    // 解析世界观（v2 @ 指令优先，旧格式兜底）
    const worldviewAtMatch = fullContent.match(/(?:^|\n)\s*@worldview\b\s*([\s\S]*?)(?=\n\s*@character\b|$)/i);
    const worldMatch = fullContent.match(/===\s*世界观设定\s*===\s*([\s\S]*?)(?====\s*角色[ABC]|$)/i);
    const worldSetting = (worldviewAtMatch ? worldviewAtMatch[1] : (worldMatch ? worldMatch[1] : "")).trim();
    
    // v2 格式: @character A "名字" + 后续 @字段
    const atCharacterMap = new Map<string, { name: string; body: string }>();
    const atCharacterMatches = fullContent.matchAll(
      /(?:^|\n)\s*@character\s+([ABC])\s+"([^"\n]+)"\s*([\s\S]*?)(?=\n\s*@character\s+[ABC]\s+"|$)/gi
    );
    for (const match of atCharacterMatches) {
      const slot = match[1].toLowerCase();
      const name = match[2].trim();
      const body = match[3].trim();
      atCharacterMap.set(slot, { name, body });
    }

    // 旧格式: === 角色A: 名字 === / === 名字 ===
    const charAMatch = fullContent.match(/===\s*角色A[：:]\s*\[?([^\]\s=]+)\]?\s*===\s*([\s\S]*?)(?====\s*角色[BC]|$)/i);
    const charBMatch = fullContent.match(/===\s*角色B[：:]\s*\[?([^\]\s=]+)\]?\s*===\s*([\s\S]*?)(?====\s*角色C|$)/i);
    const charCMatch = fullContent.match(/===\s*角色C[：:]\s*\[?([^\]\s=]+)\]?\s*===\s*([\s\S]*?)$/i);
    let altMatches: RegExpMatchArray[] = [];
    if (atCharacterMap.size === 0 && !charAMatch && !charBMatch && !charCMatch) {
      const allSections = [...fullContent.matchAll(/===\s*([^=\n]+)\s*===\s*([\s\S]*?)(?====|$)/g)];
      altMatches = allSections.filter(m => !m[1].includes("世界观"));
    }
    const altCharAMatch = altMatches[0] || null;
    const altCharBMatch = altMatches[1] || null;
    const altCharCMatch = altMatches[2] || null;
    
    // 备用方案：从脚本的 @char 标签中提取角色名
    const charNamesFromScript: string[] = [];
    const charMatches = state.chapter1Script.matchAll(/@char\s+(\S+)\s+/g);
    for (const match of charMatches) {
      const name = match[1];
      if (!charNamesFromScript.includes(name)) {
        charNamesFromScript.push(name);
      }
    }
    console.log(`   备用角色名（从脚本提取）: ${charNamesFromScript.join(', ') || '无'}`);
    
    // 提取角色名（优先级：正则匹配 > 备用格式 > 脚本@char > 默认值）
    const characterNames = {
      a: atCharacterMap.get("a")?.name || (charAMatch ? charAMatch[1].trim() : (altCharAMatch ? altCharAMatch[1].trim() : (charNamesFromScript[0] || "角色A"))),
      b: atCharacterMap.get("b")?.name || (charBMatch ? charBMatch[1].trim() : (altCharBMatch ? altCharBMatch[1].trim() : (charNamesFromScript[1] || "角色B"))),
      c: atCharacterMap.get("c")?.name || (charCMatch ? charCMatch[1].trim() : (altCharCMatch ? altCharCMatch[1].trim() : (charNamesFromScript[2] || "角色C"))),
    };
    
    // 提取角色描述内容（优先级：正则匹配 > 备用格式 > 空）
    const charAContent = atCharacterMap.get("a")?.body || (charAMatch ? charAMatch[2].trim() : (altCharAMatch ? altCharAMatch[2].trim() : ""));
    const charBContent = atCharacterMap.get("b")?.body || (charBMatch ? charBMatch[2].trim() : (altCharBMatch ? altCharBMatch[2].trim() : ""));
    const charCContent = atCharacterMap.get("c")?.body || (charCMatch ? charCMatch[2].trim() : (altCharCMatch ? altCharCMatch[2].trim() : ""));
    
    // 组合世界观+各角色描述
    const characterA = `@worldview ${worldSetting}\n@name ${characterNames.a}\n${charAContent}`;
    const characterB = `@worldview ${worldSetting}\n@name ${characterNames.b}\n${charBContent}`;
    const characterC = `@worldview ${worldSetting}\n@name ${characterNames.c}\n${charCContent}`;
    
    console.log(`   世界观: ${worldSetting.length} 字符`);
    console.log(`   角色A (${characterNames.a}): ${characterA.length} 字符`);
    console.log(`   角色B (${characterNames.b}): ${characterB.length} 字符`);
    console.log(`   角色C (${characterNames.c}): ${characterC.length} 字符`);
    
    return {
      worldSetting,
      characterA,
      characterB,
      characterC,
      characterNames,
    };
    
  } catch (error: any) {
    console.error(`\n❌ 角色提取失败: ${error.message}`);
    return { error: `角色提取失败: ${error.message}` };
  }
}

// ============ 节点: 第一章后并发任务（settings + 角色提取） ============

async function chapter1ParallelNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("⚡ 节点: 并发执行 settings1 + 角色提取");
  console.log("=".repeat(60));

  const [settingsResult, charactersResult] = await Promise.all([
    extractSettings1Node(state),
    extractCharactersNode(state),
  ]);

  return { ...settingsResult, ...charactersResult };
}

// ============ 节点: 第二章各路线 settings 提取（并行） ============

async function extractSettings2Node(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("🎨 节点: 第二章各路线 settings 提取（并行）");
  console.log("=".repeat(60));
  
  if (!state.chapter1Script || !state.chapter2RouteA || !state.chapter2RouteB || !state.chapter2RouteC) {
    return { error: "缺少剧本内容" };
  }
  
  try {
    // 仅使用第二章内容，避免混入第一章的 CG
    const contextA = state.chapter2RouteA;
    const contextB = state.chapter2RouteB;
    const contextC = state.chapter2RouteC;
    
    console.log("\n🚀 并行提取三条路线的 settings（带角色设定参考）...\n");
    
    const [settings2A, settings2B, settings2C] = await Promise.all([
      extractSettings(contextA, "路线A 第二章", state.randomSeed, state.characterA),
      extractSettings(contextB, "路线B 第二章", state.randomSeed, state.characterB),
      extractSettings(contextC, "路线C 第二章", state.randomSeed, state.characterC),
    ]);
    
    return {
      settings2A,
      settings2B,
      settings2C,
    };
    
  } catch (error: any) {
    console.error(`\n❌ 提取失败: ${error.message}`);
    return { error: `settings2 提取失败: ${error.message}` };
  }
}

// ============ 节点: 第二章后并发任务（settings2 + 结局生成） ============

async function chapter2ParallelNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("⚡ 节点: 并发执行 settings2 + 结局生成");
  console.log("=".repeat(60));

  const [settingsResult, endingsResult] = await Promise.all([
    extractSettings2Node(state),
    chapter3EndingsNode(state),
  ]);

  return { ...settingsResult, ...endingsResult };
}

// ============ 节点: 第三章各路线 settings 提取（并行） ============

async function extractSettings3Node(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("🎨 节点: 第三章各路线 settings 提取（并行）");
  console.log("=".repeat(60));
  
  // 检查必要的输入
  if (!state.chapter3EndingA) {
    console.warn("⚠️ 缺少 chapter3EndingA，跳过 settings3 提取");
    return {};
  }
  
  try {
    // 仅使用第三章内容，避免混入前面章节的 CG
    const contextA = state.chapter3EndingA || "";
    const contextB = state.chapter3EndingB || "";
    const contextC = state.chapter3EndingC || "";
    
    console.log("\n🚀 并行提取三条路线的最终 settings（带角色设定参考）...\n");
    console.log(`   路线A 内容长度: ${contextA.length} 字符`);
    console.log(`   路线B 内容长度: ${contextB.length} 字符`);
    console.log(`   路线C 内容长度: ${contextC.length} 字符`);
    
    // 使用 Promise.allSettled 避免一个失败导致全部失败
    const results = await Promise.allSettled([
      contextA ? extractSettings(contextA, "路线A 完整", state.randomSeed, state.characterA) : Promise.resolve(""),
      contextB ? extractSettings(contextB, "路线B 完整", state.randomSeed, state.characterB) : Promise.resolve(""),
      contextC ? extractSettings(contextC, "路线C 完整", state.randomSeed, state.characterC) : Promise.resolve(""),
    ]);
    
    const settings3A = results[0].status === 'fulfilled' ? results[0].value : "";
    const settings3B = results[1].status === 'fulfilled' ? results[1].value : "";
    const settings3C = results[2].status === 'fulfilled' ? results[2].value : "";
    
    // 记录失败的情况
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const routeLabel = ['A', 'B', 'C'][index];
        console.error(`   ❌ 路线${routeLabel} settings 提取失败: ${result.reason?.message || result.reason || '未知错误'}`);
      }
    });
    
    return {
      settings3A,
      settings3B,
      settings3C,
    };
    
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "未知错误";
    console.error(`\n❌ 提取失败: ${errorMsg}`);
    return { error: `settings3 提取失败: ${errorMsg}` };
  }
}

// ============ 翻译节点 ============

// 翻译辅助函数
async function translateContent(content: string, targetRegion: string, label: string, seed?: string): Promise<string> {
  let prompt = compileExtractionPrompt("translate", {
    TARGET_REGION: targetRegion,
    CONTENT: content,
  });
  prompt = appendSeedNote(prompt, seed);
  
  const model = createTextModel({ temperature: 0.3, maxOutputTokens: 8192 });
  
  console.log(`   ⏳ 翻译 ${label}...`);
  const startTime = Date.now();
  
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5秒
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await model.invoke([
        new HumanMessage(prompt),
      ]);
      
      if (!response || !response.content) {
        if (attempt < MAX_RETRIES) {
          console.warn(`   ⚠️ ${label} 返回空内容，${RETRY_DELAY/1000}秒后重试 (${attempt}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        console.warn(`   ⚠️ ${label} 翻译返回空内容，使用原文`);
        return content;
      }
      
      // 检查是否被截断（Vertex AI / Gemini finish_reason）
      const metadata = response.response_metadata as Record<string, any> | undefined;
      const finishReason = metadata?.finishReason || metadata?.finish_reason || "";
      if (finishReason === "MAX_TOKENS" || finishReason === "LENGTH") {
        if (attempt < MAX_RETRIES) {
          console.warn(`   ⚠️ ${label} 输出被截断 (${finishReason})，重试 (${attempt}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        console.warn(`   ⚠️ ${label} 输出被截断，使用原文`);
        return content;
      }
      
      const result = response.content as string;
      const endTime = Date.now();
      
      // 验证关键标记是否保留（防止 LLM 提前停止）
      const hasKeyChoice = content.includes('【关键选择】');
      const hasChapterEnd = content.includes('@end_chapter') || content.includes('【章节结束】');
      const resultHasKeyChoice = result.includes('【关键选择】');
      const resultHasChapterEnd = result.includes('@end_chapter') || result.includes('【章节结束】');
      
      if ((hasKeyChoice && !resultHasKeyChoice) || (hasChapterEnd && !resultHasChapterEnd)) {
        if (attempt < MAX_RETRIES) {
          console.warn(`   ⚠️ ${label} 翻译不完整（缺少关键标记），重试 (${attempt}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        console.warn(`   ⚠️ ${label} 翻译不完整，使用原文`);
        return content;
      }
      
      console.log(`   ✅ ${label} 翻译完成 (${((endTime - startTime) / 1000).toFixed(1)}s, ${result.length} 字符)`);
      
      return result;
    } catch (error: any) {
      const errorMsg = error?.message || String(error) || "未知错误";
      
      if (attempt < MAX_RETRIES) {
        console.warn(`   ⚠️ ${label} 翻译失败: ${errorMsg}，${RETRY_DELAY/1000}秒后重试 (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        continue;
      }
      
      console.error(`   ❌ ${label} 翻译失败（已重试${MAX_RETRIES}次）: ${errorMsg}，使用原文`);
      return content;
    }
  }
  
  return content; // 兜底返回原文
}

// 判断是否需要翻译
// 注意：简体中文生成后，除了中国大陆外的所有地区都需要翻译（包括繁体中文地区）
function shouldTranslate(targetRegion: string): boolean {
  // 只有"中国大陆"和"中国"（不含其他地区修饰）跳过翻译
  const skipRegions = ["中国大陆", "china mainland"];
  // 如果目标地区精确匹配 "中国" 或 "中国大陆"，跳过翻译
  const lowerRegion = targetRegion.toLowerCase().trim();
  if (lowerRegion === "中国" || lowerRegion === "中国大陆" || lowerRegion === "china" || lowerRegion === "china mainland") {
    return false;
  }
  // 其他所有地区（包括台湾繁体、香港、日本等）都需要翻译
  return true;
}

// 翻译节点
async function translationNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("🌐 节点: 翻译");
  console.log("=".repeat(60));
  
  const targetRegion = state.targetRegion || "中国";
  
  // 检查是否需要翻译
  if (!shouldTranslate(targetRegion)) {
    console.log(`\n⏭️ 目标地区为 ${targetRegion}，跳过翻译`);
    return { translationSuccess: true };
  }
  
  console.log(`\n🌍 目标地区: ${targetRegion}`);
  
  if (!state.chapter1Script || !state.chapter2RouteA || !state.chapter3EndingA) {
    return { error: "缺少剧本内容，无法翻译", translationSuccess: false };
  }
  
  try {
    console.log("\n🚀 分批翻译所有章节（避免并发过多）...\n");
    
    // 第一批：翻译第一章和路线A
    console.log("📦 批次 1/3: 第一章 + 路线A");
    const [translatedChapter1, translatedRouteA_ch2, translatedRouteA_ch3] = await Promise.all([
      translateContent(state.chapter1Script, targetRegion, "第一章", state.randomSeed),
      translateContent(state.chapter2RouteA, targetRegion, "路线A 第二章", state.randomSeed),
      translateContent(state.chapter3EndingA, targetRegion, "路线A 第三章", state.randomSeed),
    ]);
    
    // 第二批：翻译路线B
    console.log("\n📦 批次 2/3: 路线B");
    const [translatedRouteB_ch2, translatedRouteB_ch3] = await Promise.all([
      translateContent(state.chapter2RouteB, targetRegion, "路线B 第二章", state.randomSeed),
      translateContent(state.chapter3EndingB, targetRegion, "路线B 第三章", state.randomSeed),
    ]);
    
    // 第三批：翻译路线C
    console.log("\n📦 批次 3/3: 路线C");
    const [translatedRouteC_ch2, translatedRouteC_ch3] = await Promise.all([
      translateContent(state.chapter2RouteC, targetRegion, "路线C 第二章", state.randomSeed),
      translateContent(state.chapter3EndingC, targetRegion, "路线C 第三章", state.randomSeed),
    ]);
    
    console.log("\n✅ 所有章节翻译完成!");
    
    return {
      translatedChapter1,
      translatedRouteA: { chapter2: translatedRouteA_ch2, chapter3: translatedRouteA_ch3 },
      translatedRouteB: { chapter2: translatedRouteB_ch2, chapter3: translatedRouteB_ch3 },
      translatedRouteC: { chapter2: translatedRouteC_ch2, chapter3: translatedRouteC_ch3 },
      translationSuccess: true,
    };
    
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "未知错误";
    console.error(`\n❌ 翻译失败: ${errorMsg}`);
    return { error: `翻译失败: ${errorMsg}`, translationSuccess: false };
  }
}

// ============ 节点 2A.split: 分割第二章路线 ============

async function splitRoutesNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("✂️ 节点 2A.split: 分割第二章路线");
  console.log("=".repeat(60));
  
  if (!state.chapter2Branches) {
    return { error: "缺少第二章分支内容" };
  }
  
  const routes = splitChapter2Routes(state.chapter2Branches);
  
  if (!routes) {
    console.log("❌ 分割失败");
    return { error: "无法分割第二章路线" };
  }
  
  console.log(`✅ 分割成功`);
  console.log(`   路线A: ${routes.routeA.length} 字符`);
  console.log(`   路线B: ${routes.routeB.length} 字符`);
  console.log(`   路线C: ${routes.routeC.length} 字符`);
  
  return {
    chapter2RouteA: routes.routeA,
    chapter2RouteB: routes.routeB,
    chapter2RouteC: routes.routeC,
  };
}

// ============ 节点 3: 并行生成结局 ============

async function generateEnding(
  chapter1: string, 
  chapter2Route: string, 
  routeName: string,
  routeId: string,  // 'a', 'b', 'c'
  characterName: string,
  characterProfile: string,  // 角色设定
  preferences: PlayerPreferences,
  seed?: string
): Promise<string> {
  // 构建完整的分支上下文（第一章 + 第二章对应路线）
  const branchContext = `=== 第一章 ===
${chapter1}

=== 第二章（${routeName}） ===
${chapter2Route}`;

  // 替换变量（包含角色设定）
  const characterProfiles = { a: "", b: "", c: "" };
  characterProfiles[routeId as 'a' | 'b' | 'c'] = characterProfile;
  const variables = buildPromptVariables(preferences, undefined, characterName, characterProfiles);
  variables.CHARACTER_PROFILE = characterProfile;  // 当前路线角色的设定
  let prompt = compileNarrativePrompt("chapter3", {
    ...variables,
    BRANCH_CONTEXT: branchContext,
    ROUTE_ID: routeId,
  });
  prompt = appendSeedNote(prompt, seed);
  
  const model = createTextModel({ temperature: 0.8, maxOutputTokens: 8192 });
  
  console.log(`   ⏳ 生成 ${routeName} 结局...`);
  console.log(`      上下文: 第一章(${chapter1.length}字符) + 第二章(${chapter2Route.length}字符)`);
  const startTime = Date.now();
  
  const response = await model.invoke([
    new HumanMessage(prompt),
  ]);
  
  const ending = response.content as string;
  const endTime = Date.now();
  
  console.log(`   ✅ ${routeName} 完成 (${((endTime - startTime) / 1000).toFixed(1)}s, ${ending.length} 字符)`);
  
  return ending;
}

// ============ 节点 3: 并行生成三条路线结局（带重试） ============

async function chapter3EndingsNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
  console.log("\n" + "=".repeat(60));
  console.log("🎬 节点 3: 并行生成三条路线结局");
  console.log("=".repeat(60));

  if (!state.chapter1Script || !state.chapter2RouteA || !state.chapter2RouteB || !state.chapter2RouteC || !state.preferences) {
    return { error: "缺少剧本内容或玩家偏好", node3Success: false };
  }

  // 重试配置（针对 API 限流）
  const MAX_RETRIES = 5;
  const BASE_DELAY = 60000; // 基础等待 60 秒（更保守）

  const names = state.characterNames || { a: "角色A", b: "角色B", c: "角色C" };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n🚀 并行生成三条路线的结局（每条路线有独立的完整上下文）... (尝试 ${attempt}/${MAX_RETRIES})`);

      // 并行执行三个结局生成
      const [endingA, endingB, endingC] = await Promise.all([
        generateEnding(state.chapter1Script, state.chapter2RouteA, `路线A（${names.a}线）`, "a", names.a, state.characterA || "", state.preferences, state.randomSeed),
        generateEnding(state.chapter1Script, state.chapter2RouteB, `路线B（${names.b}线）`, "b", names.b, state.characterB || "", state.preferences, state.randomSeed),
        generateEnding(state.chapter1Script, state.chapter2RouteC, `路线C（${names.c}线）`, "c", names.c, state.characterC || "", state.preferences, state.randomSeed),
      ]);

      console.log(`\n✅ 所有结局生成完成!`);

      return {
        chapter3EndingA: endingA,
        chapter3EndingB: endingB,
        chapter3EndingC: endingC,
        node3Success: true,
      };

    } catch (error: any) {
      const errorMsg = error?.message || String(error) || "未知错误";
      const isRateLimit = errorMsg.includes("429") || errorMsg.includes("Resource exhausted") || errorMsg.includes("rate");

      if (isRateLimit && attempt < MAX_RETRIES) {
        // 指数退避：60s, 120s, 240s, 480s
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`\n⚠️ API 限流，${delay / 1000} 秒后重试 (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error(`\n❌ 结局生成失败: ${errorMsg}`);
      return { error: `结局生成失败: ${errorMsg}`, node3Success: false };
    }
  }

  return { error: "结局生成失败: 超过最大重试次数", node3Success: false };
}

// ============ 路由函数 ============

function shouldContinue(state: WorkflowStateType): "continue" | "end" {
  if (state.node1Success && state.chapter1Script) {
    return "continue";
  }
  return "end";
}

function shouldGenerateEndings(state: WorkflowStateType): "generate_endings" | "end" {
  if (state.node2aSuccess && state.chapter2RouteA && state.chapter2RouteB && state.chapter2RouteC) {
    return "generate_endings";
  }
  return "end";
}

// ============ 构建工作流 ============

function buildWorkflow() {
  const workflow = new StateGraph(WorkflowState)
    // 添加节点
    .addNode("preference_selection", preferenceSelectionNode)
    .addNode("prompt_assembly", promptAssemblyNode)
    .addNode("chapter1_generation", chapter1GenerationNode)
    .addNode("chapter1_parallel", chapter1ParallelNode)
    .addNode("chapter2_branches", chapter2BranchesNode)
    .addNode("split_routes", splitRoutesNode)
    .addNode("chapter2_parallel", chapter2ParallelNode)
    .addNode("extract_settings3", extractSettings3Node)
    .addNode("translation", translationNode)
    
    // 定义边
    .addEdge(START, "preference_selection")
    .addEdge("preference_selection", "prompt_assembly")
    .addEdge("prompt_assembly", "chapter1_generation")
    
    // 第一章完成后，并行提取 settings1 和角色描述
    .addConditionalEdges("chapter1_generation", shouldContinue, {
      continue: "chapter1_parallel",
      end: END,
    })
    // 并发节点完成后，生成第二章
    .addEdge("chapter1_parallel", "chapter2_branches")
    
    // 第二章完成后分割路线
    .addEdge("chapter2_branches", "split_routes")
    
    // 分割后并发执行 settings2 提取 + 第三章结局生成
    .addEdge("split_routes", "chapter2_parallel")
    
    // 并发节点完成后提取 settings3
    .addEdge("chapter2_parallel", "extract_settings3")
    
    // settings3完成后翻译
    .addEdge("extract_settings3", "translation")
    
    // 翻译完成后结束
    .addEdge("translation", END);
  
  return workflow.compile();
}

// ============ 分割第二章路线 ============

function splitChapter2Routes(content: string): { routeA: string; routeB: string; routeC: string } | null {
  // 方法0（优先）: 使用新的 @route_start/@route_end 标记（完整格式）
  const routeANewMatch = content.match(/@route_start\s+A\s*([\s\S]*?)@route_end\s+A/i);
  const routeBNewMatch = content.match(/@route_start\s+B\s*([\s\S]*?)@route_end\s+B/i);
  const routeCNewMatch = content.match(/@route_start\s+C\s*([\s\S]*?)@route_end\s+C/i);
  
  if (routeANewMatch && routeBNewMatch && routeCNewMatch) {
    console.log("✅ 使用 @route_start/@route_end 标记分割成功");
    return {
      routeA: routeANewMatch[1].trim(),
      routeB: routeBNewMatch[1].trim(),
      routeC: routeCNewMatch[1].trim(),
    };
  }
  
  // 方法0.5: 使用 @route_end 分割（AI 可能省略了开头的 @route_start A）
  // 匹配格式: 内容...@route_end A ... @route_start B...@route_end B ... @route_start C...@route_end C
  const routeEndAMatch = content.match(/([\s\S]*?)@route_end\s+A/i);
  const routeBPartMatch = content.match(/@route_start\s+B\s*([\s\S]*?)@route_end\s+B/i);
  const routeCPartMatch = content.match(/@route_start\s+C\s*([\s\S]*?)@route_end\s+C/i);
  
  if (routeEndAMatch && routeBPartMatch && routeCPartMatch) {
    console.log("✅ 使用 @route_end A + @route_start B/C 混合格式分割成功");
    return {
      routeA: routeEndAMatch[1].trim(),
      routeB: routeBPartMatch[1].trim(),
      routeC: routeCPartMatch[1].trim(),
    };
  }
  
  // 方法1: 使用 === 路线X: ... === ... @end_route 或 @route_end 格式
  const routeAMatch = content.match(/===\s*路线A[：:][^=]*===\s*([\s\S]*?)(?:@end_route|@route_end\s+A)/i);
  const routeBMatch = content.match(/===\s*路线B[：:][^=]*===\s*([\s\S]*?)(?:@end_route|@route_end\s+B)/i);
  const routeCMatch = content.match(/===\s*路线C[：:][^=]*===\s*([\s\S]*?)(?:@end_route|@route_end\s+C)/i);
  
  if (routeAMatch && routeBMatch && routeCMatch) {
    console.log("✅ 使用标准格式分割成功");
    return {
      routeA: routeAMatch[1].trim(),
      routeB: routeBMatch[1].trim(),
      routeC: routeCMatch[1].trim(),
    };
  }
  
  // 方法2: 仅通过 @end_route 或 @route_end 分割（三段）
  const endRoutePattern = /@(?:end_route|route_end\s+[ABC])/gi;
  const endRouteMatches = content.match(endRoutePattern);
  
  if (endRouteMatches && endRouteMatches.length >= 3) {
    console.log("✅ 使用 @end_route/@route_end 标记分割");
    const parts = content.split(/@(?:end_route|route_end\s+[ABC])/i);
    if (parts.length >= 3) {
      return {
        routeA: parts[0].trim(),
        routeB: parts[1].trim(),
        routeC: parts[2].trim(),
      };
    }
  }
  
  // 方法3: 按角色名分割（林夏/苏若/白羽 等常见名字）
  const charPattern = /(?:【|##\s*|===\s*)(路线|线路|角色)?[ABC]?[：:]?\s*(林夏|苏若|白羽|真白|澪|夏织|[一-龥]{2,3})(?:线|路线|的故事)?(?:【|===)?/g;
  const charMatches = [...content.matchAll(charPattern)];
  
  if (charMatches.length >= 3) {
    console.log("✅ 使用角色名分割");
    const positions = charMatches.map(m => m.index!);
    return {
      routeA: content.slice(positions[0], positions[1]).trim(),
      routeB: content.slice(positions[1], positions[2]).trim(),
      routeC: content.slice(positions[2]).trim(),
    };
  }
  
  // 方法4: 按 === 或 --- 分隔符分割
  const separatorParts = content.split(/(?:={5,}|={3}\s*\n|---{3,})/);
  if (separatorParts.length >= 4) {
    console.log("✅ 使用分隔符分割");
    return {
      routeA: separatorParts[1]?.trim() || "",
      routeB: separatorParts[2]?.trim() || "",
      routeC: separatorParts[3]?.trim() || "",
    };
  }
  
  console.log("⚠️ 所有分割方法均失败");
  console.log(`   内容预览: ${content.substring(0, 500)}...`);
  return null;
}

// ============ 保存结果 ============

async function saveResults(state: WorkflowStateType, outputDir?: string) {
  // 输出目录：可指定或使用默认的 assets/story/
  const storyDir = outputDir || path.join(__dirname, "../../assets/story");
  
  // 创建路线子目录
  const routeADir = path.join(storyDir, "route_a");
  const routeBDir = path.join(storyDir, "route_b");
  const routeCDir = path.join(storyDir, "route_c");
  
  [storyDir, routeADir, routeBDir, routeCDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  
  const savedFiles: string[] = [];

  const writeScriptWithLint = (filePath: string, content: string): void => {
    const lint = lintScript(content, getScriptSpecMode());
    if (!lint.ok) {
      const top = lint.errors.slice(0, 3).map(e => `[L${e.line}] ${e.code}`).join(", ");
      console.warn(`⚠️ 保存前脚本 lint 未通过 (${path.basename(filePath)}): ${top}`);
    }
    fs.writeFileSync(filePath, lint.normalizedText, "utf-8");
  };
  
  // 保存共同的第一章
  if (state.chapter1Script) {
    const ch1Path = path.join(storyDir, "chapter1.txt");
    writeScriptWithLint(ch1Path, state.chapter1Script);
    savedFiles.push(ch1Path);
  }
  
  // 保存第一章的 settings
  if (state.settings1) {
    const s1Path = path.join(storyDir, "settings_1.txt");
    fs.writeFileSync(s1Path, state.settings1, "utf-8");
    savedFiles.push(s1Path);
  }
  
  // 保存角色描述文件（世界观+单个角色）
  const charactersDir = path.join(storyDir, "characters");
  if (!fs.existsSync(charactersDir)) {
    fs.mkdirSync(charactersDir, { recursive: true });
  }
  
  if (state.characterA) {
    const charName = state.characterNames?.a || "角色A";
    const charPath = path.join(charactersDir, `character_${charName}.txt`);
    fs.writeFileSync(charPath, state.characterA, "utf-8");
    savedFiles.push(charPath);
  }
  if (state.characterB) {
    const charName = state.characterNames?.b || "角色B";
    const charPath = path.join(charactersDir, `character_${charName}.txt`);
    fs.writeFileSync(charPath, state.characterB, "utf-8");
    savedFiles.push(charPath);
  }
  if (state.characterC) {
    const charName = state.characterNames?.c || "角色C";
    const charPath = path.join(charactersDir, `character_${charName}.txt`);
    fs.writeFileSync(charPath, state.characterC, "utf-8");
    savedFiles.push(charPath);
  }
  
  // 保存路线A（真白线）
  if (state.chapter2RouteA) {
    const ch2Path = path.join(routeADir, "chapter2.txt");
    writeScriptWithLint(ch2Path, state.chapter2RouteA);
    savedFiles.push(ch2Path);
  }
  if (state.settings2A) {
    const s2Path = path.join(routeADir, "settings_2.txt");
    fs.writeFileSync(s2Path, state.settings2A, "utf-8");
    savedFiles.push(s2Path);
  }
  if (state.chapter3EndingA) {
    const ch3Path = path.join(routeADir, "chapter3.txt");
    writeScriptWithLint(ch3Path, state.chapter3EndingA);
    savedFiles.push(ch3Path);
  }
  if (state.settings3A) {
    const s3Path = path.join(routeADir, "settings_3.txt");
    fs.writeFileSync(s3Path, state.settings3A, "utf-8");
    savedFiles.push(s3Path);
  }
  
  // 保存路线B（林夏线）
  if (state.chapter2RouteB) {
    const ch2Path = path.join(routeBDir, "chapter2.txt");
    writeScriptWithLint(ch2Path, state.chapter2RouteB);
    savedFiles.push(ch2Path);
  }
  if (state.settings2B) {
    const s2Path = path.join(routeBDir, "settings_2.txt");
    fs.writeFileSync(s2Path, state.settings2B, "utf-8");
    savedFiles.push(s2Path);
  }
  if (state.chapter3EndingB) {
    const ch3Path = path.join(routeBDir, "chapter3.txt");
    writeScriptWithLint(ch3Path, state.chapter3EndingB);
    savedFiles.push(ch3Path);
  }
  if (state.settings3B) {
    const s3Path = path.join(routeBDir, "settings_3.txt");
    fs.writeFileSync(s3Path, state.settings3B, "utf-8");
    savedFiles.push(s3Path);
  }
  
  // 保存路线C（澪线）
  if (state.chapter2RouteC) {
    const ch2Path = path.join(routeCDir, "chapter2.txt");
    writeScriptWithLint(ch2Path, state.chapter2RouteC);
    savedFiles.push(ch2Path);
  }
  if (state.settings2C) {
    const s2Path = path.join(routeCDir, "settings_2.txt");
    fs.writeFileSync(s2Path, state.settings2C, "utf-8");
    savedFiles.push(s2Path);
  }
  if (state.chapter3EndingC) {
    const ch3Path = path.join(routeCDir, "chapter3.txt");
    writeScriptWithLint(ch3Path, state.chapter3EndingC);
    savedFiles.push(ch3Path);
  }
  if (state.settings3C) {
    const s3Path = path.join(routeCDir, "settings_3.txt");
    fs.writeFileSync(s3Path, state.settings3C, "utf-8");
    savedFiles.push(s3Path);
  }
  
  // 保存翻译后的内容（如果有）- 直接覆盖原始文件
  const hasTranslation = state.translatedChapter1 && state.translatedChapter1.length > 0;
  if (hasTranslation) {
    console.log(`\n🌐 应用翻译内容（覆盖原始文件）...`);
    
    // 直接覆盖原始文件为翻译后的版本
    // 第一章
    const ch1Path = path.join(storyDir, "chapter1.txt");
    writeScriptWithLint(ch1Path, state.translatedChapter1);
    console.log(`   ✅ 覆盖 chapter1.txt`);
    
    // 路线A
    if (state.translatedRouteA?.chapter2) {
      writeScriptWithLint(path.join(routeADir, "chapter2.txt"), state.translatedRouteA.chapter2);
      console.log(`   ✅ 覆盖 route_a/chapter2.txt`);
    }
    if (state.translatedRouteA?.chapter3) {
      writeScriptWithLint(path.join(routeADir, "chapter3.txt"), state.translatedRouteA.chapter3);
      console.log(`   ✅ 覆盖 route_a/chapter3.txt`);
    }
    
    // 路线B
    if (state.translatedRouteB?.chapter2) {
      writeScriptWithLint(path.join(routeBDir, "chapter2.txt"), state.translatedRouteB.chapter2);
      console.log(`   ✅ 覆盖 route_b/chapter2.txt`);
    }
    if (state.translatedRouteB?.chapter3) {
      writeScriptWithLint(path.join(routeBDir, "chapter3.txt"), state.translatedRouteB.chapter3);
      console.log(`   ✅ 覆盖 route_b/chapter3.txt`);
    }
    
    // 路线C
    if (state.translatedRouteC?.chapter2) {
      writeScriptWithLint(path.join(routeCDir, "chapter2.txt"), state.translatedRouteC.chapter2);
      console.log(`   ✅ 覆盖 route_c/chapter2.txt`);
    }
    if (state.translatedRouteC?.chapter3) {
      writeScriptWithLint(path.join(routeCDir, "chapter3.txt"), state.translatedRouteC.chapter3);
      console.log(`   ✅ 覆盖 route_c/chapter3.txt`);
    }
    
    console.log(`\n🌐 翻译完成，脚本文件已更新为目标语言版本`);
  }
  
  // 保存游戏存档数据 (JSON格式，供游戏加载)
  const saveDataPath = path.join(storyDir, "save_data.json");
  const saveData = {
    version: "1.0",
    scriptSpecVersion: "v2_strict",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    
    // 游戏标题（由 LLM 生成）
    gameTitle: state.gameTitle || "",
    
    // 玩家偏好
    preferences: {
      playerId: state.preferences?.playerId,
      preferredEffect: state.preferences?.visual.preferredEffect,
      preferredSeason: state.preferences?.visual.preferredSeason,
    },
    
    // settings（供生图 agent 使用）
    settings: {
      settings_1: state.settings1,
      route_a: { settings_2: state.settings2A, settings_3: state.settings3A },
      route_b: { settings_2: state.settings2B, settings_3: state.settings3B },
      route_c: { settings_2: state.settings2C, settings_3: state.settings3C },
    },
    
    // 检测到的角色列表
    characters: state.chapter1Characters,
    
    // 角色描述文件（供立绘生成）
    characterDescriptions: {
      names: state.characterNames,
      files: state.characterNames ? {
        [state.characterNames.a]: `characters/character_${state.characterNames.a}.txt`,
        [state.characterNames.b]: `characters/character_${state.characterNames.b}.txt`,
        [state.characterNames.c]: `characters/character_${state.characterNames.c}.txt`,
      } : null,
    },
    
    // 脚本文件路径
    story: {
      chapter1: "chapter1.txt",
      settings_1: "settings_1.txt",
      route_a: {
        chapter2: "route_a/chapter2.txt",
        settings_2: "route_a/settings_2.txt",
        chapter3: "route_a/chapter3.txt",
        settings_3: "route_a/settings_3.txt",
      },
      route_b: {
        chapter2: "route_b/chapter2.txt",
        settings_2: "route_b/settings_2.txt",
        chapter3: "route_b/chapter3.txt",
        settings_3: "route_b/settings_3.txt",
      },
      route_c: {
        chapter2: "route_c/chapter2.txt",
        settings_2: "route_c/settings_2.txt",
        chapter3: "route_c/chapter3.txt",
        settings_3: "route_c/settings_3.txt",
      },
    },
    
    // 翻译信息
    translation: {
      targetRegion: state.targetRegion,
      hasTranslation: hasTranslation,
      // 翻译后的内容已直接覆盖原始脚本文件
      translationApplied: hasTranslation,
    },
    
    // 生成状态
    generationStatus: {
      chapter1: state.node1Success,
      chapter2: state.node2aSuccess,
      chapter3: state.node3Success,
      settings: state.node2bSuccess,
      translation: state.translationSuccess,
    },
  };
  fs.writeFileSync(saveDataPath, JSON.stringify(saveData, null, 2), "utf-8");
  savedFiles.push(saveDataPath);
  
  console.log(`\n📥 结果已保存到 assets/story/ 目录:`);
  console.log(`\n   目录结构:`);
  console.log(`   assets/story/`);
  console.log(`   ├── chapter1.txt             # 共同第一章`);
  console.log(`   ├── settings_1.txt           # 第一章 settings`);
  console.log(`   ├── characters/              # 角色描述（供立绘生成）`);
  if (state.characterNames) {
    console.log(`   │   ├── character_${state.characterNames.a}.txt`);
    console.log(`   │   ├── character_${state.characterNames.b}.txt`);
    console.log(`   │   └── character_${state.characterNames.c}.txt`);
  }
  console.log(`   ├── route_a/`);
  console.log(`   │   ├── chapter2.txt         # 路线A 第二章`);
  console.log(`   │   ├── settings_2.txt       # 路线A 第二章 settings`);
  console.log(`   │   ├── chapter3.txt         # 路线A 结局`);
  console.log(`   │   └── settings_3.txt       # 路线A 完整 settings`);
  console.log(`   ├── route_b/`);
  console.log(`   │   ├── chapter2.txt`);
  console.log(`   │   ├── settings_2.txt`);
  console.log(`   │   ├── chapter3.txt`);
  console.log(`   │   └── settings_3.txt`);
  console.log(`   ├── route_c/`);
  console.log(`   │   ├── chapter2.txt`);
  console.log(`   │   ├── settings_2.txt`);
  console.log(`   │   ├── chapter3.txt`);
  console.log(`   │   └── settings_3.txt`);
  console.log(`   └── save_data.json           # 游戏存档数据`);
  if (hasTranslation) {
    console.log(`\n   📝 注意: 脚本已翻译为目标语言 (${state.targetRegion})`);
  }
  
  return savedFiles;
}

// ============ 导出接口 ============

export interface StoryWorkflowOptions {
  /** 翻译目标地区 (默认 "中国"，即不翻译) */
  targetRegion?: string;
  /** 输出目录 (默认 assets/story/) */
  outputDir?: string;
}

/**
 * 运行完整工作流（供外部调用）
 */
export async function runWorkflow(options?: StoryWorkflowOptions): Promise<void> {
  const targetRegion = options?.targetRegion || "中国";
  const outputDir = options?.outputDir;
  
  console.log("=".repeat(60));
  console.log("🎮 完整生成工作流 (API 调用)");
  console.log("=".repeat(60));
  console.log(`配置: 模型=${TEXT_MODEL}, 区域=${VERTEX_CONFIG.location}`);
  console.log(`翻译目标: ${targetRegion}`);
  if (outputDir) {
    console.log(`输出目录: ${outputDir}`);
  }
  
  const graph = buildWorkflow();
  const result = await graph.invoke({ targetRegion });
  
  await saveResults(result, outputDir);
  
  console.log("\n✅ 剧本生成完成!");
}

// ============ 主函数 ============

async function main() {
  console.log("=".repeat(60));
  console.log("🎮 完整生成工作流");
  console.log("=".repeat(60));
  
  console.log(`
工作流结构:
┌─────────────────────────┐
│ 1.1 偏好选择            │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 1.2 提示词装配          │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 1.3 第一章生成          │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ settings_1 提取         │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 👥 角色描述提取 (x3)    │
│ (世界观+各角色分开保存) │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 2A 第二章分支生成       │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 分割三路线              │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ settings_2 提取 (x3并行)│
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 第三章结局生成 (x3并行) │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ settings_3 提取 (x3并行)│
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 🌐 翻译 (x7并行)        │
│ (如为中文则跳过)        │
└─────────────────────────┘
`);
  
  // 解析命令行参数获取翻译目标地区
  // 使用方式: tsx workflow-full-generation.ts --region "日本"
  const regionIndex = process.argv.indexOf("--region");
  const targetRegion = regionIndex !== -1 && process.argv[regionIndex + 1] 
    ? process.argv[regionIndex + 1] 
    : "中国";  // 默认中文，跳过翻译
  
  console.log(`配置: 模型=${TEXT_MODEL}, 区域=${VERTEX_CONFIG.location}`);
  console.log(`翻译目标: ${targetRegion}`);
  
  // 构建并运行
  const graph = buildWorkflow();
  
  console.log("\n" + "─".repeat(60));
  console.log("开始执行工作流...");
  console.log("─".repeat(60));
  
  const result = await graph.invoke({ targetRegion });
  
  // 保存结果
  await saveResults(result);
  
  // 显示摘要
  console.log("\n" + "=".repeat(60));
  console.log("📊 执行结果摘要");
  console.log("=".repeat(60));
  console.log(`   第一章: ${result.node1Success ? "✅" : "❌"}`);
  console.log(`   settings_1: ${result.node2bSuccess ? "✅" : "❌"}`);
  console.log(`   角色描述 (x3): ${result.characterA ? "✅" : "❌"}`);
  console.log(`   第二章分支: ${result.node2aSuccess ? "✅" : "❌"}`);
  console.log(`   settings_2 (x3): ${result.settings2A ? "✅" : "❌"}`);
  console.log(`   第三章结局 (x3): ${result.node3Success ? "✅" : "❌"}`);
  console.log(`   settings_3 (x3): ${result.settings3A ? "✅" : "❌"}`);
  console.log(`   翻译: ${result.translationSuccess ? (result.translatedChapter1 ? "✅" : "⏭️ 跳过(中文)") : "❌"}`);
  
  if (result.error) {
    console.log(`\n   错误: ${result.error}`);
  }
  
  // 显示第一章预览
  if (result.chapter1Script) {
    console.log("\n" + "─".repeat(60));
    console.log("📖 第一章预览 (前 1000 字符):");
    console.log("─".repeat(60));
    console.log(result.chapter1Script.substring(0, 1000));
    console.log("...");
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("✅ 工作流执行完成!");
  console.log("=".repeat(60));
}

// 仅在直接运行时执行（不是被 import 时）
const isMainModule = process.argv[1]?.includes("workflow-full-generation");
if (isMainModule) {
  main().catch(console.error);
}
