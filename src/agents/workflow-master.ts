/**
 * 主编排工作流 - 完整的 Galgame 资产生成管线
 * 
 * 将以下管线串联：
 * 1. 剧本生成 (workflow-full-generation) - 生成故事脚本、提取设定和角色描述
 * 2. 角色立绘生成 (character-sprite-agent) - 基于角色描述生成立绘
 * 3. CG 生成 (cg-agent) - 基于场景设定生成 CG
 * 4. 世界配置生成 - 生成 world.json 并更新索引
 * 
 * 依赖关系：
 * - 角色立绘依赖: extract_characters (角色描述)
 * - CG 生成依赖: extract_settings (settings_1/2/3.txt)
 * 
 * 执行顺序：
 * Phase 1: 剧本生成 (所有章节 + 设定提取 + 角色提取)
 * Phase 2: 角色立绘生成 (3个角色并行)
 * Phase 3: CG 生成 (7个CG并行: 1+3+3)
 * Phase 4: 生成 world.json 配置
 * 
 * 输出目录: assets/worlds/{worldId}/
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage, AIMessage } from "@langchain/core/messages";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import { fileURLToPath } from "url";

// 导入世界路径工具
import {
  WorldPaths,
  createWorldPaths,
  ensureWorldDirs,
  addWorldToIndex,
  WorldIndexEntry,
} from "./utils/world-paths.js";

// 导入子工作流
import { runWorkflow as runStoryWorkflow } from "./workflow-full-generation.js";
import { generateCharacterSprite, CharacterInput, CharacterSpriteResult } from "./character-sprite-agent.js";
import { generateCG, CGGenerationResult } from "./cg-agent.js";
import { buildWorldSemanticModel, type CGSource } from "./services/world-semantic-model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ 类型定义 ============

interface CharacterInfo {
  name: string;
  descriptionPath: string;
  worldSetting: string;
  appearance: string;
  outfit: string;
  accessories: string;  // 配饰（眼镜、头饰、徽章等）
}

interface CGInfo {
  source: string;
  settingsPath: string;
  scriptPath?: string;
  cgName?: string;
  cgTitle?: string;
}

type MasterPhase = 
  | "init"
  | "story_generation"      // Phase 1: 剧本生成
  | "character_generation"  // Phase 2: 角色立绘
  | "cg_generation"         // Phase 3: CG 生成
  | "world_config"          // Phase 4: 生成配置
  | "completed"
  | "failed";

// ============ 状态定义 ============

const MasterState = Annotation.Root({
  // 世界路径配置
  worldPaths: Annotation<WorldPaths | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),
  
  // 生成参数
  generationParams: Annotation<{ language: string; theme: string; atmosphere: string } | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),
  
  // 当前阶段
  currentPhase: Annotation<MasterPhase>({
    reducer: (_, newVal) => newVal,
    default: () => "init",
  }),
  
  // Phase 1 结果
  storyGenerated: Annotation<boolean>({
    reducer: (_, newVal) => newVal,
    default: () => false,
  }),
  
  // 检测到的角色信息
  characters: Annotation<CharacterInfo[]>({
    reducer: (_, newVal) => newVal,
    default: () => [],
  }),
  
  // 检测到的 CG 设定
  cgSettings: Annotation<CGInfo[]>({
    reducer: (_, newVal) => newVal,
    default: () => [],
  }),
  
  // Phase 2 结果
  characterSpritesGenerated: Annotation<number>({
    reducer: (_, newVal) => newVal,
    default: () => 0,
  }),
  
  // Phase 3 结果
  cgsGenerated: Annotation<number>({
    reducer: (_, newVal) => newVal,
    default: () => 0,
  }),
  
  // 错误信息
  error: Annotation<string | null>({
    reducer: (_, newVal) => newVal,
    default: () => null,
  }),
  
  // 消息日志
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => [...curr, ...update],
    default: () => [],
  }),
});

type MasterStateType = typeof MasterState.State;

// ============ 辅助函数 ============

/**
 * 扫描角色描述文件
 */
function scanCharacterFiles(storyCharactersDir: string): CharacterInfo[] {
  const characters: CharacterInfo[] = [];
  
  if (!fs.existsSync(storyCharactersDir)) {
    return characters;
  }
  
  const files = fs.readdirSync(storyCharactersDir);
  
  for (const file of files) {
    if (file.startsWith("character_") && file.endsWith(".txt")) {
      const filePath = path.join(storyCharactersDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      
      // 提取角色名
      const nameMatch = file.match(/character_(.+)\.txt/);
      const name = nameMatch ? nameMatch[1] : file;
      
      // 解析内容 - 支持多种格式
      // 格式1: "外貌描述: xxx" / "服装设定: xxx"
      // 格式2: "外貌: xxx" / "服装: xxx" / "配饰: xxx"
      const worldMatch = content.match(/(?:^|\n)\s*@worldview\b\s*([^\n]+)/i) ||
                         content.match(/世界观设定[：:]?\s*([\s\S]*?)(?===|$)/i) ||
                         content.match(/=== 世界观设定 ===\s*([\s\S]*?)(?===|$)/i);
      
      const appearanceMatch = content.match(/(?:^|\n)\s*@appearance\b\s*([^\n]+)/i) ||
                              content.match(/外貌[描述]*[：:]\s*([^\n]+)/i);
      const outfitMatch = content.match(/(?:^|\n)\s*@outfit\b\s*([^\n]+)/i) ||
                          content.match(/服装[设定]*[：:]\s*([^\n]+)/i);
      const accessoriesMatch = content.match(/(?:^|\n)\s*@accessories\b\s*([^\n]+)/i) ||
                               content.match(/配饰[：:]\s*([^\n]+)/i);
      
      // 从服装字段中提取配饰（兼容旧格式：[xxx] 中括号内容）
      let outfit = outfitMatch ? outfitMatch[1].trim() : "";
      let accessories = accessoriesMatch ? accessoriesMatch[1].trim() : "";
      
      // 如果没有单独的配饰字段，尝试从服装字段提取中括号内容
      if (!accessories && outfit) {
        const bracketMatch = outfit.match(/\[([^\]]+)\]/);
        if (bracketMatch) {
          accessories = bracketMatch[1];
          // 从服装中移除配饰部分
          outfit = outfit.replace(/\s*\[[^\]]+\]\s*/g, "").trim();
        }
      }
      
      characters.push({
        name,
        descriptionPath: filePath,
        worldSetting: worldMatch ? worldMatch[1].trim() : "",
        appearance: appearanceMatch ? appearanceMatch[1].trim() : "",
        outfit,
        accessories,
      });
    }
  }
  
  return characters;
}

/**
 * 扫描 CG 设定文件
 */
function scanCGSettings(storyDir: string): CGInfo[] {
  const settings: CGInfo[] = [];

  const semantic = buildWorldSemanticModel(storyDir);
  const semanticBySource = new Map(semantic.expectedCGs.map(item => [item.source, item]));

  const settingsMap: Record<CGSource, string> = {
    chapter1: path.join(storyDir, "settings_1.txt"),
    chapter2_route_a: path.join(storyDir, "route_a", "settings_2.txt"),
    chapter2_route_b: path.join(storyDir, "route_b", "settings_2.txt"),
    chapter2_route_c: path.join(storyDir, "route_c", "settings_2.txt"),
    chapter3_route_a: path.join(storyDir, "route_a", "settings_3.txt"),
    chapter3_route_b: path.join(storyDir, "route_b", "settings_3.txt"),
    chapter3_route_c: path.join(storyDir, "route_c", "settings_3.txt"),
  };

  for (const [source, settingsPath] of Object.entries(settingsMap) as Array<[CGSource, string]>) {
    if (!fs.existsSync(settingsPath)) continue;
    const semanticCG = semanticBySource.get(source);
    settings.push({
      source,
      settingsPath,
      scriptPath: semanticCG?.scriptPath,
      cgName: semanticCG?.id,
      cgTitle: semanticCG?.title,
    });
  }

  return settings;
}

/**
 * 转换中文描述为英文关键词（简化版）
 */
function translateToKeywords(text: string): string {
  if (!text) return "";
  
  const translations: Record<string, string> = {
    // 颜色
    "黑色": "black", "白色": "white", "棕色": "brown", "金色": "golden",
    "红色": "red", "蓝色": "blue", "粉色": "pink", "紫色": "purple",
    "银色": "silver", "橙色": "orange", "绿色": "green", "灰色": "gray",
    // 发型
    "长发": "long hair", "短发": "short hair", "马尾": "ponytail",
    "双马尾": "twintails", "卷发": "curly hair", "直发": "straight hair",
    "齐刘海": "blunt bangs", "侧分": "side-swept bangs", "姬发": "hime cut",
    // 服装
    "校服": "school uniform", "制服": "uniform", "裙子": "skirt",
    "西装外套": "blazer", "开衫": "cardigan", "衬衫": "shirt",
    // 配饰 - 眼部
    "眼镜": "glasses", "银边眼镜": "silver-framed glasses", 
    "圆框眼镜": "round glasses", "无框眼镜": "rimless glasses",
    // 配饰 - 头部
    "发饰": "hair accessory", "丝带": "ribbon", "发带": "headband",
    "蝴蝶结": "bow", "发夹": "hairpin", "发卡": "hair clip",
    // 配饰 - 颈部
    "围巾": "scarf", "项链": "necklace", "领结": "ribbon tie",
    // 配饰 - 其他
    "手环": "wristband", "手镯": "bracelet", "耳环": "earrings",
    "袖章": "armband", "学生会袖章": "student council armband",
    "徽章": "badge", "护腕": "wristband",
    // 体型
    "高中生": "high school student", "学生": "student",
    "温柔": "gentle", "活泼": "cheerful", "冷淡": "cold", "害羞": "shy",
    "苗条": "slender", "娇小": "petite", "高挑": "tall",
  };
  
  let result = text;
  for (const [cn, en] of Object.entries(translations)) {
    result = result.replace(new RegExp(cn, "g"), en);
  }
  
  // 提取英文词汇
  const englishWords = result.match(/[a-zA-Z][a-zA-Z\s\-]+/g) || [];
  return englishWords.join(", ").toLowerCase();
}

/**
 * 生成角色主题色
 */
function generateCharacterColor(index: number): string {
  const colors = ["#FFB7C5", "#87CEEB", "#DDA0DD", "#98FB98", "#FFA500", "#F0E68C"];
  return colors[index % colors.length];
}

// ============ 工作流节点 ============

/**
 * 初始化节点
 */
async function initNode(state: MasterStateType): Promise<Partial<MasterStateType>> {
  const worldPaths = state.worldPaths!;
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          Galgame 完整资产生成管线                           ║
║          Master Orchestration Workflow                      ║
╚════════════════════════════════════════════════════════════╝

🌍 世界 ID: ${worldPaths.worldId}
📁 输出目录: ${worldPaths.baseDir}
`);
  
  // 确保目录存在
  ensureWorldDirs(worldPaths);
  
  console.log("🚀 [初始化] 检查现有资产...\n");
  
  // 检查是否已有剧本
  const chapter1Exists = fs.existsSync(path.join(worldPaths.storyDir, "chapter1.txt"));
  const charactersExist = scanCharacterFiles(worldPaths.storyCharactersDir).length > 0;
  const settingsExist = scanCGSettings(worldPaths.storyDir).length > 0;
  
  console.log(`   📁 剧本文件: ${chapter1Exists ? "✅ 存在" : "❌ 不存在"}`);
  console.log(`   👤 角色描述: ${charactersExist ? "✅ 存在" : "❌ 不存在"}`);
  console.log(`   🎨 CG 设定: ${settingsExist ? "✅ 存在" : "❌ 不存在"}`);
  
  return {
    currentPhase: "story_generation",
    messages: [new AIMessage("[初始化] 管线启动")],
  };
}

/**
 * Phase 1: 剧本生成节点
 */
async function storyGenerationNode(state: MasterStateType): Promise<Partial<MasterStateType>> {
  const worldPaths = state.worldPaths!;
  
  console.log(`
────────────────────────────────────────────────────────────
📖 Phase 1: 剧本生成
────────────────────────────────────────────────────────────
`);
  
  // 检查是否已有完整剧本
  const settingsCount = scanCGSettings(worldPaths.storyDir).length;
  const charactersCount = scanCharacterFiles(worldPaths.storyCharactersDir).length;
  
  if (settingsCount >= 7 && charactersCount >= 3) {
    console.log("   ✅ 检测到完整剧本资产，跳过生成");
    
    return {
      storyGenerated: true,
      characters: scanCharacterFiles(worldPaths.storyCharactersDir),
      cgSettings: scanCGSettings(worldPaths.storyDir),
      currentPhase: "character_generation",
      messages: [new AIMessage("[Phase 1] 使用现有剧本")],
    };
  }
  
  console.log("   🔄 开始生成剧本...");
  console.log("   （这可能需要几分钟）\n");
  
  // 将语言代码映射到目标地区
  const languageToRegion: Record<string, string> = {
    "zh-CN": "中国大陆",
    "zh-TW": "台湾（繁体中文）",
    "ja": "日本",
    "ko": "韩国",
    "en": "美国",
    "es": "西班牙",
    "fr": "法国",
    "de": "德国",
    "pt": "巴西",
    "ru": "俄罗斯",
    "it": "意大利",
    "vi": "越南",
    "th": "泰国",
    "id": "印度尼西亚",
    "ar": "阿拉伯",
  };
  
  const language = state.generationParams?.language || "zh-CN";
  const targetRegion = languageToRegion[language] || "中国大陆";
  console.log(`   🌍 目标语言: ${language} (${targetRegion})`);
  
  try {
    // 调用剧本生成工作流，传入输出目录和翻译目标
    await runStoryWorkflow({ outputDir: worldPaths.storyDir, targetRegion });
    
    console.log("\n   ✅ 剧本生成完成！");
    
    // 重新扫描资产
    const characters = scanCharacterFiles(worldPaths.storyCharactersDir);
    const cgSettings = scanCGSettings(worldPaths.storyDir);
    
    console.log(`   📊 生成结果:`);
    console.log(`      角色描述: ${characters.length} 个`);
    console.log(`      CG 设定: ${cgSettings.length} 个`);
    
    return {
      storyGenerated: true,
      characters,
      cgSettings,
      currentPhase: "character_generation",
      messages: [new AIMessage("[Phase 1] 剧本生成完成")],
    };
  } catch (error) {
    console.error(`   ❌ 剧本生成失败: ${error}`);
    return {
      currentPhase: "failed",
      error: `剧本生成失败: ${error}`,
    };
  }
}

/**
 * 检查角色资产是否已完整存在
 * nobg 是最后一步，检查 nobg 目录下的所有必要文件
 */
function isCharacterAssetComplete(charactersDir: string, charName: string): boolean {
  const safeName = charName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const charDir = path.join(charactersDir, safeName);
  const nobgDir = path.join(charDir, "nobg");
  
  // nobg 是最后一步，检查 nobg 目录下的所有必要文件
  const requiredNobgFiles = [
    "polished_sprite.png",   // 润色后立绘
    "expression_happy.png",  // 表情-开心
    "expression_angry.png",  // 表情-生气
    "expression_sad.png",    // 表情-悲伤
    "expression_joy.png",    // 表情-大笑
    "portrait.png",          // 头像
  ];
  
  return requiredNobgFiles.every(file => 
    fs.existsSync(path.join(nobgDir, file))
  );
}

/**
 * Phase 2: 角色立绘生成节点
 */
async function characterGenerationNode(state: MasterStateType): Promise<Partial<MasterStateType>> {
  const worldPaths = state.worldPaths!;
  
  console.log(`
────────────────────────────────────────────────────────────
👤 Phase 2: 角色立绘生成
────────────────────────────────────────────────────────────
`);
  
  const characters = state.characters;
  
  if (characters.length === 0) {
    console.log("   ⚠️ 未找到角色描述，跳过立绘生成");
    return {
      currentPhase: "cg_generation",
      messages: [new AIMessage("[Phase 2] 无角色描述，跳过")],
    };
  }
  
  // 检查哪些角色已有完整资产
  const charactersToGenerate: CharacterInfo[] = [];
  const skippedCharacters: string[] = [];
  
  for (const char of characters) {
    if (isCharacterAssetComplete(worldPaths.charactersDir, char.name)) {
      skippedCharacters.push(char.name);
    } else {
      charactersToGenerate.push(char);
    }
  }
  
  console.log(`   📊 角色资产检查:`);
  console.log(`      需要生成: ${charactersToGenerate.length} 个`);
  console.log(`      已有资产: ${skippedCharacters.length} 个`);
  
  if (skippedCharacters.length > 0) {
    console.log(`   ⏭️ 跳过已有资产的角色: ${skippedCharacters.join(", ")}`);
  }
  
  if (charactersToGenerate.length === 0) {
    console.log("   ✅ 所有角色资产已存在，跳过生成");
    return {
      characterSpritesGenerated: characters.length,
      currentPhase: "cg_generation",
      messages: [new AIMessage("[Phase 2] 所有角色资产已存在，跳过")],
    };
  }
  
  console.log(`\n   🎯 将生成 ${charactersToGenerate.length} 个角色的立绘:`);
  charactersToGenerate.forEach((c, i) => {
    console.log(`      ${i + 1}. ${c.name}`);
  });
  console.log();
  
  let successCount = skippedCharacters.length; // 已有的算作成功
  
  // 逐个生成角色立绘（避免 API 限流）
  for (const char of charactersToGenerate) {
    console.log(`\n   🔄 生成角色: ${char.name}`);
    
    try {
      const input: CharacterInput = {
        name: char.name,
        worldSetting: translateToKeywords(char.worldSetting),
        appearance: translateToKeywords(char.appearance),
        outfit: translateToKeywords(char.outfit),
        accessories: translateToKeywords(char.accessories),  // 传入配饰信息
      };
      
      console.log(`      📋 配饰: ${char.accessories || '(无)'}`);
      
      // 传入输出目录
      const result = await generateCharacterSprite(input, {
        outputDir: worldPaths.charactersDir,
      });
      
      if (result.success) {
        successCount++;
        console.log(`      ✅ ${char.name} 生成成功`);
      } else {
        console.log(`      ❌ ${char.name} 生成失败: ${result.error}`);
      }
    } catch (error) {
      console.log(`      ❌ ${char.name} 生成异常: ${error}`);
    }
  }
  
  console.log(`\n   📊 角色立绘结果: ${successCount}/${characters.length} 成功`);
  
  return {
    characterSpritesGenerated: successCount,
    currentPhase: "cg_generation",
    messages: [new AIMessage(`[Phase 2] 角色立绘完成: ${successCount}/${characters.length}`)],
  };
}

/**
 * 检查某个 CG 是否已存在
 * CG 目录命名规则: chapter1 -> ch1, chapter2_route_a -> ch2_a
 */
function isCGAssetComplete(cgDir: string, source: string): boolean {
  if (process.env.FORCE_REGEN_CG === "1") {
    return false;
  }
  // 转换 source 到目录名
  const folderName = source
    .replace("chapter", "ch")
    .replace("_route_", "_");
  
  const cgFolder = path.join(cgDir, folderName);
  
  if (!fs.existsSync(cgFolder)) {
    return false;
  }
  
  // 检查文件夹中是否有 .png 文件
  const files = fs.readdirSync(cgFolder);
  const hasPng = files.some(f => f.endsWith(".png") && !f.includes("_metadata"));
  
  return hasPng;
}

/**
 * Phase 3: CG 生成节点
 */
async function cgGenerationNode(state: MasterStateType): Promise<Partial<MasterStateType>> {
  const worldPaths = state.worldPaths!;
  
  console.log(`
────────────────────────────────────────────────────────────
🎨 Phase 3: CG 生成
────────────────────────────────────────────────────────────
`);
  
  const cgSettings = state.cgSettings;
  
  if (cgSettings.length === 0) {
    console.log("   ⚠️ 未找到 CG 设定，跳过 CG 生成");
    return {
      currentPhase: "world_config",
      messages: [new AIMessage("[Phase 3] 无 CG 设定，跳过")],
    };
  }
  
  // 检查哪些 CG 已有资产
  const cgsToGenerate: CGInfo[] = [];
  const skippedCGs: string[] = [];
  
  for (const cg of cgSettings) {
    if (isCGAssetComplete(worldPaths.cgDir, cg.source)) {
      skippedCGs.push(cg.source);
    } else {
      cgsToGenerate.push(cg);
    }
  }
  
  console.log(`   📊 CG 资产检查:`);
  console.log(`      需要生成: ${cgsToGenerate.length} 个`);
  console.log(`      已有资产: ${skippedCGs.length} 个`);
  
  if (skippedCGs.length > 0) {
    console.log(`   ⏭️ 跳过已有资产的 CG: ${skippedCGs.join(", ")}`);
  }
  
  if (cgsToGenerate.length === 0) {
    console.log("   ✅ 所有 CG 资产已存在，跳过生成");
    return {
      cgsGenerated: cgSettings.length,
      currentPhase: "world_config",
      messages: [new AIMessage("[Phase 3] 所有 CG 资产已存在，跳过")],
    };
  }
  
  console.log(`\n   🎯 将生成 ${cgsToGenerate.length} 个 CG:`);
  cgsToGenerate.forEach((cg, i) => {
    console.log(`      ${i + 1}. ${cg.source}`);
  });
  console.log();
  
  let successCount = skippedCGs.length; // 已有的算作成功
  
  // 根据 CG source 获取对应角色的立绘路径
  function getCharacterSpriteForCG(source: string): string | undefined {
    // chapter1 暂不关联角色（共通线）
    if (source === "chapter1") {
      return undefined;
    }
    
    // 从 settings 文件中读取角色名（更可靠，避免角色顺序问题）
    const routeMatch = source.match(/route_([abc])/);
    if (!routeMatch) return undefined;
    
    const routeLetter = routeMatch[1] as 'a' | 'b' | 'c';
    const chapterMatch = source.match(/chapter(\d)/);
    const chapterNum = chapterMatch ? chapterMatch[1] : '2';
    
    const normalizeCharacterName = (rawName: string): string => {
      let name = rawName.trim();
      name = name.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
      name = name.replace(/^[\[\]【】]+|[\[\]【】]+$/g, "");
      const splitMatch = name.match(/^([^,，、;；。(\[（]+)/);
      if (splitMatch) {
        name = splitMatch[1].trim();
      }
      return name;
    };

    // 读取对应路线的 settings 文件来获取角色名
    const settingsPath = path.join(worldPaths.storyDir, `route_${routeLetter}`, `settings_${chapterNum}.txt`);
    let characterName: string | undefined;
    
    if (fs.existsSync(settingsPath)) {
      const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
      // v2 优先：@character 指令块
      const atCharacterBlockMatch = settingsContent.match(/(?:^|\n)\s*@character\b([\s\S]*?)(?=\n\s*@\w+\b|$)/i);
      if (atCharacterBlockMatch) {
        const atCharacterBlock = atCharacterBlockMatch[1].replace(/^[：:\-=\s]+/, "").trim();
        const namedMatch = atCharacterBlock.match(/(?:姓名|name)\s*[：:=]\s*([^\s,，;；。]+)/i);
        if (namedMatch) {
          characterName = normalizeCharacterName(namedMatch[1]);
        } else {
          // 兼容简写：@character 角色名, 外貌...
          const compactMatch = atCharacterBlock.match(/^([^\s,，;；。]+)/);
          if (compactMatch) {
            characterName = normalizeCharacterName(compactMatch[1]);
          }
        }
      }

      // 从 settings 文件中提取角色名（格式: [角色] 名字、描述... 或 [角色] 名字，描述... 或 [角色] 名字。描述...）
      const charTagMatch = !characterName ? settingsContent.match(/\[角色\]\s*([^、，,。\s]+)/) : null;
      if (charTagMatch && !characterName) {
        characterName = normalizeCharacterName(charTagMatch[1]);
      }
      // 备用：从 "=== 角色名 ===" 格式提取
      if (!characterName) {
        const charMatch = settingsContent.match(/===\s*([^\s=]+)\s*===/);
        if (charMatch && !charMatch[1].includes('世界观') && !charMatch[1].includes('设定')) {
          characterName = normalizeCharacterName(charMatch[1]);
        }
      }
      // 备用：从 "路线X: 角色名" 格式提取
      if (!characterName) {
        const routeNameMatch = settingsContent.match(/路[线線][ABC][：:]\s*(\S+)/i);
        if (routeNameMatch) {
          characterName = normalizeCharacterName(routeNameMatch[1]);
        }
      }
    }
    
    // 如果从 settings 找不到，尝试从 chapter 脚本中提取
    if (!characterName) {
      const chapterPath = path.join(worldPaths.storyDir, `route_${routeLetter}`, `chapter${chapterNum}.txt`);
      if (fs.existsSync(chapterPath)) {
        const chapterContent = fs.readFileSync(chapterPath, 'utf-8');
        // 从脚本标题行提取（格式: === 路线X: 角色名 === 或 === 路線X：角色名 ===）
        const titleMatch = chapterContent.match(/===\s*路[线線][ABC][：:]\s*(\S+)\s*===/i);
        if (titleMatch) {
          characterName = normalizeCharacterName(titleMatch[1]);
        }
        // 备用：从第一个 @char 命令提取
        if (!characterName) {
          const charCmdMatch = chapterContent.match(/@char\s+(\S+)\s+/);
          if (charCmdMatch) {
            characterName = normalizeCharacterName(charCmdMatch[1]);
          }
        }
      }
    }
    
    if (!characterName) {
      console.log(`      ⚠️ 无法从 ${source} 确定角色名`);
      return undefined;
    }
    
    // 尝试精确匹配
    let matchedDir = characterName;
    let nobgSpritePath = path.join(worldPaths.charactersDir, matchedDir, "nobg", "polished_sprite.png");
    
    if (!fs.existsSync(nobgSpritePath)) {
      // 精确匹配失败，尝试模糊匹配（查找包含角色名的目录）
      if (fs.existsSync(worldPaths.charactersDir)) {
        const dirs = fs.readdirSync(worldPaths.charactersDir);
        const fuzzyMatch = dirs.find(dir => dir.includes(characterName));
        if (fuzzyMatch) {
          matchedDir = fuzzyMatch;
          nobgSpritePath = path.join(worldPaths.charactersDir, matchedDir, "nobg", "polished_sprite.png");
        }
      }
    }
    
    // 构建角色立绘路径（使用透明背景版本避免白边）
    if (fs.existsSync(nobgSpritePath)) {
      console.log(`      📌 关联角色: ${characterName} → ${matchedDir} (透明背景)`);
      return nobgSpritePath;
    }
    
    // fallback: 如果没有 nobg 版本，使用原版
    const spritePath = path.join(worldPaths.charactersDir, matchedDir, "polished_sprite.png");
    if (fs.existsSync(spritePath)) {
      console.log(`      📌 关联角色: ${characterName} → ${matchedDir} (原版)`);
      return spritePath;
    }
    
    console.log(`      ⚠️ 角色 ${characterName} 立绘不存在（查找: ${matchedDir}）`);
    return undefined;
  }
  
  // 逐个生成 CG（避免 API 限流）
  for (const cg of cgsToGenerate) {
    console.log(`\n   🔄 生成 CG: ${cg.source}`);
    
    // 获取对应角色的立绘路径
    const characterSpritePath = getCharacterSpriteForCG(cg.source);
    
    try {
      // 传入输出目录和角色立绘路径
      const result = await generateCG({
        source: cg.source as any,
        settingsFile: cg.settingsPath,
        sceneDescription: "",
        characterDescription: "",
        cgName: cg.cgName,
        cgTitle: cg.cgTitle,
        characterSpritePath,  // 新增：角色立绘路径
      }, {
        outputDir: worldPaths.cgDir,
      });
      
      if (result.success) {
        successCount++;
        console.log(`      ✅ ${cg.source} CG 生成成功`);
      } else {
        console.log(`      ❌ ${cg.source} CG 生成失败: ${result.error}`);
      }
    } catch (error) {
      console.log(`      ❌ ${cg.source} CG 生成异常: ${error}`);
    }
  }
  
  console.log(`\n   📊 CG 生成结果: ${successCount}/${cgSettings.length} 成功`);
  
  return {
    cgsGenerated: successCount,
    currentPhase: "world_config",
    messages: [new AIMessage(`[Phase 3] CG 生成完成: ${successCount}/${cgSettings.length}`)],
  };
}

/**
 * Phase 4: 生成世界配置节点
 */
async function worldConfigNode(state: MasterStateType): Promise<Partial<MasterStateType>> {
  const worldPaths = state.worldPaths!;
  
  console.log(`
────────────────────────────────────────────────────────────
⚙️ Phase 4: 生成世界配置
────────────────────────────────────────────────────────────
`);
  
  try {
    // 扫描生成的角色立绘
    const characterFolders = fs.existsSync(worldPaths.charactersDir)
      ? fs.readdirSync(worldPaths.charactersDir).filter(f =>
          fs.statSync(path.join(worldPaths.charactersDir, f)).isDirectory()
        )
      : [];
    const characterFolderSet = new Set(characterFolders);
    
    // 优先使用 save_data.json 中的路线角色顺序（a/b/c）
    const saveDataPath = path.join(worldPaths.storyDir, "save_data.json");
    let saveData: any | null = null;
    if (fs.existsSync(saveDataPath)) {
      try {
        saveData = JSON.parse(fs.readFileSync(saveDataPath, "utf-8"));
      } catch {
        saveData = null;
      }
    }

    const routeOrderNames = [
      saveData?.characterDescriptions?.names?.a,
      saveData?.characterDescriptions?.names?.b,
      saveData?.characterDescriptions?.names?.c,
    ].filter((name): name is string => typeof name === "string" && name.trim().length > 0);

    // 其次使用剧本生成的角色名称（story/characters）
    // 如果 state.characters 为空，重新扫描 story/characters 目录
    let storyCharacters = state.characters || [];
    if (storyCharacters.length === 0) {
      storyCharacters = scanCharacterFiles(worldPaths.storyCharactersDir);
    }
    let storyNames = storyCharacters
      .map(c => c.name)
      .filter((name, index, arr) => arr.indexOf(name) === index);
    if (routeOrderNames.length > 0) {
      storyNames = routeOrderNames;
      console.log(`   📌 使用 save_data 路线顺序: ${routeOrderNames.join(", ")}`);
    }
    
    const semanticModel = buildWorldSemanticModel(worldPaths.storyDir);
    
    // 限制角色数量最多为 3 个（因为只有 route_a/b/c 三条路线）
    const limitedStoryNames = storyNames.slice(0, 3);
    const limitedCharFolders = characterFolders.slice(0, 3);
    
    if (storyNames.length > 3) {
      console.warn(`⚠️ 检测到 ${storyNames.length} 个角色，但只支持 3 条路线，将只使用前 3 个: ${limitedStoryNames.join(', ')}`);
    }
    
    // 构建角色配置（名称来自剧本，目录名尽量匹配已有立绘）
    // 清理角色名中可能的方括号（LLM 有时会输出 [角色名]）
    const cleanName = (n: string) => n.replace(/^\[|\]$/g, '').trim();
    
    const characterEntries = (limitedStoryNames.length > 0 ? limitedStoryNames : limitedCharFolders).map((name, index) => {
      const cleaned = cleanName(name);
      const fallbackFolder = characterFolders[index];
      const folderName = characterFolderSet.has(cleaned) ? cleaned : (fallbackFolder || cleaned);
      
      if (!characterFolderSet.has(cleaned)) {
        console.warn(`⚠️ 角色立绘目录未找到: ${cleaned}，使用目录: ${folderName}`);
      }
      
      return { name: cleaned, folderName };
    });
    
    const charactersConfig = characterEntries.map((entry, index) => ({
      id: `char_${index + 1}`,
      name: entry.name,
      color: generateCharacterColor(index),
      folder: `characters/${entry.folderName}`,
      expressions: ["default", "happy", "angry", "sad", "joy"],
    }));
    
    // 构建 CG 配置（语义模型优先；语义为空时回退目录扫描，兼容旧世界）
    const cgsConfig = semanticModel.expectedCGs.length > 0
      ? semanticModel.expectedCGs.map(cg => {
          const metadataPath = path.join(worldPaths.baseDir, cg.path.replace(/\.png$/, "_metadata.json"));
          let title = cg.title;
          if (fs.existsSync(metadataPath)) {
            try {
              const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
              title = metadata.title || title;
            } catch {
              // ignore metadata parse failure
            }
          }
          const chapter = cg.path.split("/")[1] || "ch1";
          return {
            id: cg.id,
            name: cg.id,
            title,
            chapter,
            path: cg.path,
          };
        })
      : (() => {
          const cgFolders = fs.existsSync(worldPaths.cgDir)
            ? fs.readdirSync(worldPaths.cgDir).filter(f =>
                fs.statSync(path.join(worldPaths.cgDir, f)).isDirectory()
              )
            : [];
          return cgFolders.flatMap(folder => {
            const cgDir = path.join(worldPaths.cgDir, folder);
            const pngFiles = fs.readdirSync(cgDir).filter(f => f.endsWith(".png") && !f.includes("_metadata"));
            return pngFiles.map(file => {
              const base = path.basename(file, ".png");
              return {
                id: base,
                name: base,
                title: undefined,
                chapter: folder,
                path: `cg/${folder}/${file}`,
              };
            });
          });
        })();
    
    // 构建章节配置
    const chaptersConfig = {
      common: [
        {
          id: "chapter1",
          title: "第一章",
          script: "story/chapter1.txt",
        },
      ],
      routes: {} as Record<string, any[]>,
    };
    
    // 为每个角色创建路线
    const routes = ["a", "b", "c"];
    charactersConfig.forEach((char, index) => {
      const routeId = routes[index] || routes[0];
      chaptersConfig.routes[char.id] = [
        {
          id: `chapter2_${char.id}`,
          title: `第二章：${char.name}路线`,
          script: `story/route_${routeId}/chapter2.txt`,
        },
        {
          id: `chapter3_${char.id}`,
          title: `第三章：${char.name}结局`,
          script: `story/route_${routeId}/chapter3.txt`,
        },
      ];
    });
    
    // 读取 save_data.json 获取游戏标题
    let gameTitle = "AI 生成世界";
    if (saveData?.gameTitle && saveData.gameTitle.trim()) {
      gameTitle = saveData.gameTitle.trim();
      console.log(`   🎮 游戏标题: ${gameTitle}`);
    }
    
    // 构建完整的 world.json
    const generationParams = state.generationParams || {
      language: "zh-CN",
      theme: "school_romance",
      atmosphere: "sakura",
    };
    
    const worldConfig = {
      uid: worldPaths.worldId,
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      
      generationParams,
      
      game: {
        title: gameTitle,
        description: "由 AI 自动生成的视觉小说世界",
        characters: charactersConfig,
        chapters: chaptersConfig,
        endings: charactersConfig.map(char => ({
          id: `ending_${char.id}`,
          characterId: char.id,
          title: `${char.name}结局`,
        })),
        cgs: cgsConfig,
        backgrounds: [
          "school_gate", "classroom", "hallway", "club_room",
          "rooftop_cloudy", "rooftop_clear", "night_room",
          "street_morning", "park",
        ],
        bgmTypes: ["title", "calm", "happy", "emotional", "romantic", "sad"],
      },
      
      assets: {
        characters: Object.fromEntries(
          charactersConfig.map(char => [
            char.id,
            {
              name: char.name,
              folder: char.folder,
              sprites: {
                default: `${char.folder}/nobg/polished_sprite.png`,
                happy: `${char.folder}/nobg/expression_happy.png`,
                angry: `${char.folder}/nobg/expression_angry.png`,
                sad: `${char.folder}/nobg/expression_sad.png`,
                joy: `${char.folder}/nobg/expression_joy.png`,
              },
              portrait: `${char.folder}/nobg/portrait.png`,
            },
          ])
        ),
      },
      
      stats: {
        totalCharacters: charactersConfig.length,
        totalCGs: cgsConfig.length,
        totalChapters: 1 + charactersConfig.length * 2,
        generationTime: null,
      },
    };
    
    // 保存 world.json
    fs.writeFileSync(
      worldPaths.worldConfigPath,
      JSON.stringify(worldConfig, null, 2),
      "utf-8"
    );
    
    console.log(`   ✅ world.json 已生成`);
    console.log(`      角色: ${charactersConfig.length} 个`);
    console.log(`      CG: ${cgsConfig.length} 张`);
    
    // 更新世界索引
    const indexEntry: WorldIndexEntry = {
      uid: worldPaths.worldId,
      title: worldConfig.game.title,
      description: worldConfig.game.description,
      createdAt: worldConfig.createdAt,
      lastPlayedAt: null,
      thumbnail: null,
      generationParams,
      stats: {
        totalCharacters: worldConfig.stats.totalCharacters,
        totalCGs: worldConfig.stats.totalCGs,
        totalChapters: worldConfig.stats.totalChapters,
        playCount: 0,
        completedEndings: 0,
      },
    };
    
    addWorldToIndex(indexEntry);
    console.log(`   ✅ 世界索引已更新`);
    
    return {
      currentPhase: "completed",
      messages: [new AIMessage("[Phase 4] 世界配置生成完成")],
    };
  } catch (error) {
    console.error(`   ❌ 世界配置生成失败: ${error}`);
    return {
      currentPhase: "failed",
      error: `世界配置生成失败: ${error}`,
    };
  }
}

/**
 * 完成节点
 */
async function completionNode(state: MasterStateType): Promise<Partial<MasterStateType>> {
  const worldPaths = state.worldPaths!;

  const expectedCharacters = state.characters.length;
  const expectedCGs = state.cgSettings.length;

  const actualCharacterFolders = fs.existsSync(worldPaths.charactersDir)
    ? fs.readdirSync(worldPaths.charactersDir).filter(name =>
        fs.statSync(path.join(worldPaths.charactersDir, name)).isDirectory()
      )
    : [];
  const actualCharacters = actualCharacterFolders.length;

  let actualCGs = 0;
  if (fs.existsSync(worldPaths.cgDir)) {
    const cgFolders = fs.readdirSync(worldPaths.cgDir).filter(name =>
      fs.statSync(path.join(worldPaths.cgDir, name)).isDirectory()
    );
    for (const folder of cgFolders) {
      const files = fs.readdirSync(path.join(worldPaths.cgDir, folder));
      actualCGs += files.filter(f => f.endsWith(".png") && !f.includes("_metadata")).length;
    }
  }

  const formatProgress = (done: number, total: number): string => {
    if (total <= 0) return "⚠️ 未检测到目标（0）";
    if (done >= total) return `✅ ${done}/${total} 完成`;
    return `⚠️ ${done}/${total} 完成`;
  };
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    生成完成报告                             ║
╚════════════════════════════════════════════════════════════╝

🌍 世界 ID: ${worldPaths.worldId}

📊 生成统计:
   📖 剧本: ${state.storyGenerated ? "✅ 完成" : "❌ 失败"}
   👤 角色立绘(任务): ${formatProgress(state.characterSpritesGenerated, expectedCharacters)}
   👤 角色立绘(落盘): ${formatProgress(actualCharacters, expectedCharacters)}
   🎨 CG(任务): ${formatProgress(state.cgsGenerated, expectedCGs)}
   🎨 CG(落盘): ${formatProgress(actualCGs, expectedCGs)}

📁 资产目录:
   ${worldPaths.baseDir}/
   ├── world.json      # 世界配置
   ├── story/          # 剧本文件
   ├── characters/     # 角色立绘
   └── cg/             # CG 图像

════════════════════════════════════════════════════════════
`);
  
  return {
    messages: [new AIMessage("[完成] 所有资产生成完毕")],
  };
}

// ============ 路由函数 ============

function routeByPhase(state: MasterStateType): string {
  switch (state.currentPhase) {
    case "story_generation":
      return "story_generation";
    case "character_generation":
      return "character_generation";
    case "cg_generation":
      return "cg_generation";
    case "world_config":
      return "world_config";
    case "completed":
      return "completion";
    case "failed":
      return END;
    default:
      return END;
  }
}

// ============ 构建工作流 ============

function buildMasterWorkflow() {
  const workflow = new StateGraph(MasterState)
    .addNode("init", initNode)
    .addNode("story_generation", storyGenerationNode)
    .addNode("character_generation", characterGenerationNode)
    .addNode("cg_generation", cgGenerationNode)
    .addNode("world_config", worldConfigNode)
    .addNode("completion", completionNode)
    
    .addEdge(START, "init")
    .addConditionalEdges("init", routeByPhase)
    .addConditionalEdges("story_generation", routeByPhase)
    .addConditionalEdges("character_generation", routeByPhase)
    .addConditionalEdges("cg_generation", routeByPhase)
    .addConditionalEdges("world_config", routeByPhase)
    .addEdge("completion", END);
  
  return workflow.compile();
}

// ============ 导出接口 ============

export interface MasterWorkflowOptions {
  worldId?: string;
  skipStory?: boolean;
  skipCharacters?: boolean;
  skipCG?: boolean;
  language?: string;
  effect?: string;
  theme?: string;
}

export interface MasterWorkflowResult {
  worldId: string;
  worldPath: string;
  success: boolean;
  error?: string;
}

export async function runMasterWorkflow(options?: MasterWorkflowOptions): Promise<MasterWorkflowResult> {
  // 默认启用 v2 提示词与脚本规范（可通过环境变量覆盖）
  if (!process.env.PROMPT_BRANCH) {
    process.env.PROMPT_BRANCH = "v2";
  }
  if (!process.env.SCRIPT_SPEC_MODE) {
    process.env.SCRIPT_SPEC_MODE = "strict_v2";
  }

  // 创建世界路径
  const worldPaths = createWorldPaths(options?.worldId);
  ensureWorldDirs(worldPaths);
  
  const diagnostics = {
    logLines: { info: 0, warn: 0, error: 0 },
    retriesTriggered: 0,
    rateLimitHits: 0,
    transientFailureEvents: 0,
    characterJobs: { attempted: 0, success: 0, failed: 0 },
    cgJobs: { attempted: 0, success: 0, failed: 0 },
  };

  const logPath = path.join(worldPaths.baseDir, "log.txt");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  
  const writeLog = (level: "INFO" | "WARN" | "ERROR", args: any[]) => {
    const message = util.format(...args);
    if (level === "INFO") diagnostics.logLines.info++;
    if (level === "WARN") diagnostics.logLines.warn++;
    if (level === "ERROR") diagnostics.logLines.error++;

    if (/重试\s*\(\d+\/\d+\)/.test(message) || /第\s*\d+\s*次尝试/.test(message)) {
      diagnostics.retriesTriggered++;
    }
    if (/429|RESOURCE_EXHAUSTED|rateLimitExceeded/i.test(message)) {
      diagnostics.rateLimitHits++;
    }
    if (
      /提取失败|生成失败|调用失败|润色失败|表情生成失败|Invalid URL|UNPARSEABLE/i.test(message) &&
      !/已存在|跳过/.test(message)
    ) {
      diagnostics.transientFailureEvents++;
    }
    if (/🔄\s*生成角色:/.test(message)) {
      diagnostics.characterJobs.attempted++;
    }
    if (/✅\s*.+\s*生成成功/.test(message) && !/CG/.test(message)) {
      diagnostics.characterJobs.success++;
    }
    if (/❌\s*.+\s*生成失败|❌\s*.+\s*生成异常/.test(message) && !/CG/.test(message)) {
      diagnostics.characterJobs.failed++;
    }
    if (/🔄\s*生成 CG:/.test(message)) {
      diagnostics.cgJobs.attempted++;
    }
    if (/✅\s*.+\s*CG 生成成功/.test(message)) {
      diagnostics.cgJobs.success++;
    }
    if (/❌\s*.+\s*CG 生成失败|❌\s*.+\s*CG 生成异常/.test(message)) {
      diagnostics.cgJobs.failed++;
    }

    logStream.write(`[${new Date().toISOString()}] [${level}] ${message}\n`);
  };
  
  console.log = (...args) => {
    originalConsole.log(...args);
    writeLog("INFO", args);
  };
  console.info = (...args) => {
    originalConsole.info(...args);
    writeLog("INFO", args);
  };
  console.warn = (...args) => {
    originalConsole.warn(...args);
    writeLog("WARN", args);
  };
  console.error = (...args) => {
    originalConsole.error(...args);
    writeLog("ERROR", args);
  };
  
  const workflow = buildMasterWorkflow();
  
  const initialState: Partial<MasterStateType> = {
    worldPaths,
    currentPhase: "init",
    storyGenerated: options?.skipStory || false,
    characters: options?.skipStory ? scanCharacterFiles(worldPaths.storyCharactersDir) : [],
    cgSettings: options?.skipStory ? scanCGSettings(worldPaths.storyDir) : [],
    generationParams: {
      language: options?.language || "zh-CN",
      theme: options?.theme || "school_romance",
      atmosphere: options?.effect || "sakura",
    },
  };
  
  try {
    const finalState = await workflow.invoke(initialState);

    console.log(`
📈 过程诊断统计:
   日志行数: INFO=${diagnostics.logLines.info}, WARN=${diagnostics.logLines.warn}, ERROR=${diagnostics.logLines.error}
   重试触发: ${diagnostics.retriesTriggered}
   限流命中(429): ${diagnostics.rateLimitHits}
   中间失败事件: ${diagnostics.transientFailureEvents}
   角色任务: attempted=${diagnostics.characterJobs.attempted}, success=${diagnostics.characterJobs.success}, failed=${diagnostics.characterJobs.failed}
   CG任务: attempted=${diagnostics.cgJobs.attempted}, success=${diagnostics.cgJobs.success}, failed=${diagnostics.cgJobs.failed}
`);
    
    return {
      worldId: worldPaths.worldId,
      worldPath: worldPaths.baseDir,
      success: finalState.currentPhase === "completed",
      error: finalState.error || undefined,
    };
  } catch (error) {
    return {
      worldId: worldPaths.worldId,
      worldPath: worldPaths.baseDir,
      success: false,
      error: String(error),
    };
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    logStream.end();
  }
}

// ============ CLI 入口 ============

async function main() {
  const args = process.argv.slice(2);
  
  const options: MasterWorkflowOptions = {
    skipStory: args.includes("--skip-story"),
    skipCharacters: args.includes("--skip-characters"),
    skipCG: args.includes("--skip-cg"),
  };
  
  // 解析 --world-id 参数
  const worldIdIndex = args.indexOf("--world-id");
  if (worldIdIndex !== -1 && args[worldIdIndex + 1]) {
    options.worldId = args[worldIdIndex + 1];
  }
  
  // 解析 --effect 参数
  const effectArg = args.find(a => a.startsWith("--effect="));
  if (effectArg) {
    options.effect = effectArg.split("=")[1];
    console.log(`🎨 使用特效: ${options.effect}`);
  }
  
  // 解析 --lang 参数
  const langArg = args.find(a => a.startsWith("--lang="));
  if (langArg) {
    options.language = langArg.split("=")[1];
    console.log(`🌍 目标语言: ${options.language}`);
  }
  
  if (args.includes("--help")) {
    console.log(`
Galgame 完整资产生成管线

用法:
  tsx workflow-master.ts                        运行完整管线（自动生成世界ID）
  tsx workflow-master.ts --world-id my_world    指定世界ID
  tsx workflow-master.ts --effect=sakura        指定特效 (sakura/rain/snow/stars/leaves/hearts/fireflies)
  tsx workflow-master.ts --lang=zh-CN           指定语言 (zh-CN/zh-TW/ja/ko/en/es/fr/de/pt/ru/it/vi/th/id/ar)
  tsx workflow-master.ts --skip-story           跳过剧本生成（使用现有剧本）
  tsx workflow-master.ts --skip-characters      跳过角色立绘生成
  tsx workflow-master.ts --skip-cg              跳过 CG 生成

特效选项:
  sakura    - 🌸 樱花飘落（春天、校园、浪漫）
  rain      - 🌧️ 雨滴下落（雨天、忧伤）
  snow      - ❄️ 雪花飘落（冬天、圣诞）
  stars     - ✨ 星空闪烁（夜晚、浪漫）
  leaves    - 🍂 落叶飘落（秋天、离别）
  hearts    - 💕 心形飘落（告白、心动）
  fireflies - 🔥 萤火虫（夏夜、浪漫）

管线阶段:
  Phase 1: 剧本生成 (story)
    - 生成第1-3章剧本
    - 提取世界观和角色描述
    - 提取 CG 场景设定
  
  Phase 2: 角色立绘生成 (characters)
    - 基于角色描述生成 MJ 立绘
    - Gemini 润色
    - 生成表情表
    - 裁剪头像
    - 抠图
  
  Phase 3: CG 生成 (cg)
    - 基于场景设定转换为 NanoBanana 标签
    - MJ 生成 CG 图像
  
  Phase 4: 配置生成
    - 扫描生成的资产
    - 生成 world.json
    - 更新世界索引

输出目录: assets/worlds/{worldId}/
`);
    return;
  }
  
  const result = await runMasterWorkflow(options);
  
  if (result.success) {
    console.log(`\n✅ 管线执行成功！世界 ID: ${result.worldId}`);
  } else {
    console.error(`\n❌ 管线执行失败: ${result.error}`);
    process.exit(1);
  }
}

main().catch(console.error);
