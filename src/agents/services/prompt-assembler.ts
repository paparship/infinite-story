/**
 * 提示词装配服务
 * 
 * 负责将玩家偏好注入到提示词模板中
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { compilePrompt } from "./prompt-compiler.js";
import { 
  PlayerPreferences, 
  PromptTemplateVariables, 
  AVAILABLE_EFFECTS,
  EffectType 
} from "../types/player-preferences.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 提示词目录
const PROMPTS_DIR = path.join(__dirname, "../prompts");

/**
 * 从玩家偏好生成模板变量
 */
export function buildTemplateVariables(preferences: PlayerPreferences): PromptTemplateVariables {
  const effect = preferences.visual.preferredEffect;
  const effectInfo = AVAILABLE_EFFECTS[effect];
  
  return {
    PREFERRED_EFFECT: effect,
    EFFECT_NAME: effectInfo.name,
    EFFECT_DESCRIPTION: effectInfo.description,
    SEASON: preferences.visual.preferredSeason,
    CHARACTER_TYPE: preferences.story.preferredCharacterType,
    MOOD: preferences.story.preferredMood,
  };
}

/**
 * 替换模板中的变量
 * 变量格式: {{VARIABLE_NAME}}
 */
export function replaceTemplateVariables(
  template: string, 
  variables: PromptTemplateVariables
): string {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      // 替换 {{KEY}} 格式的变量
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      result = result.replace(pattern, value);
    }
  }
  
  return result;
}

/**
 * 加载并装配提示词
 */
export function assemblePrompt(
  templateName: string,
  preferences: PlayerPreferences
): string {
  // 生成变量
  const variables = buildTemplateVariables(preferences);

  // 优先走契约驱动编译，失败时回退到旧逻辑（兼容历史模板）
  let assembled: string;
  try {
    const contractId = templateName.startsWith("text/") || templateName.startsWith("image/")
      ? templateName
      : `text/${templateName}`;
    assembled = compilePrompt(contractId, variables).renderedPrompt;
  } catch {
    const templatePath = path.join(PROMPTS_DIR, `${templateName}.txt`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`提示词模板不存在: ${templatePath}`);
    }
    const template = fs.readFileSync(templatePath, "utf-8");
    assembled = replaceTemplateVariables(template, variables);
  }
  
  console.log(`📝 提示词装配完成`);
  console.log(`   模板: ${templateName}`);
  console.log(`   特效: ${variables.PREFERRED_EFFECT} (${variables.EFFECT_NAME})`);
  console.log(`   季节: ${variables.SEASON}`);
  
  return assembled;
}

/**
 * 生成特效使用指南（注入到提示词中）
 */
export function generateEffectGuide(preferredEffect: EffectType): string {
  const effectInfo = AVAILABLE_EFFECTS[preferredEffect];
  
  // 获取同季节的其他特效作为备选
  const sameSeasonEffects = Object.entries(AVAILABLE_EFFECTS)
    .filter(([key, info]) => 
      info.season === effectInfo.season || info.season === "通用"
    )
    .map(([key, info]) => `@effect ${key} // ${info.name} - ${info.description}`)
    .join("\n");
  
  return `
## 玩家偏好特效

玩家喜欢的主要特效是 **${effectInfo.name}** (\`@effect ${preferredEffect}\`)
适用场景：${effectInfo.description}

在以下情况优先使用玩家偏好的特效：
- 重要的情感场景
- 章节开头/结尾
- 关键选择前后

### 可用特效列表（按玩家偏好排序）

主要特效（优先使用）：
@effect ${preferredEffect} // ${effectInfo.name} - ${effectInfo.description}

同风格特效（可交替使用）：
${sameSeasonEffects}

### 特效使用示例

\`\`\`
@bg school_gate
@effect ${preferredEffect}
旁白：${effectInfo.description.split("、")[0]}的场景展开...

@char 真白 happy center
真白：「今天的天气真好呢」
\`\`\`
`;
}

/**
 * 列出所有可用的提示词模板
 */
export function listTemplates(): string[] {
  if (!fs.existsSync(PROMPTS_DIR)) {
    return [];
  }
  
  return fs.readdirSync(PROMPTS_DIR)
    .filter(f => f.endsWith(".txt"))
    .map(f => f.replace(".txt", ""));
}
