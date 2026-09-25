/**
 * 玩家偏好系统 - 类型定义
 */

// 可用的粒子特效类型
export const AVAILABLE_EFFECTS = {
  sakura: { name: "樱花飘落", description: "春天、校园、浪漫、相遇", season: "春" },
  rain: { name: "雨滴下落", description: "雨天、忧伤、思念", season: "通用" },
  snow: { name: "雪花飘落", description: "冬天、寒冷、圣诞", season: "冬" },
  stars: { name: "星空闪烁", description: "夜晚、天台、浪漫", season: "通用" },
  dust: { name: "灰尘漂浮", description: "室内、阳光、午后", season: "通用" },
  leaves: { name: "落叶飘落", description: "秋天、离别", season: "秋" },
  hearts: { name: "心形飘落", description: "告白、心动、恋爱", season: "通用" },
  light: { name: "阳光光束", description: "温暖、希望、美好", season: "通用" },
  fireflies: { name: "萤火虫", description: "夏夜、浪漫", season: "夏" },
  petals: { name: "花瓣飘落", description: "通用浪漫", season: "通用" },
} as const;

export type EffectType = keyof typeof AVAILABLE_EFFECTS;

// 偏好问题类型
export interface PreferenceQuestion {
  id: string;
  question: string;
  options: PreferenceOption[];
}

export interface PreferenceOption {
  id: string;
  label: string;
  value: string;
  description?: string;
}

// 玩家偏好数据结构
export interface PlayerPreferences {
  // 唯一标识
  playerId: string;
  // 创建时间
  createdAt: string;
  // 更新时间
  updatedAt: string;
  
  // === 视觉偏好 ===
  visual: {
    // 喜欢的特效
    preferredEffect: EffectType;
    // 喜欢的季节氛围
    preferredSeason: "春" | "夏" | "秋" | "冬" | "通用";
  };
  
  // === 剧情偏好 ===
  story: {
    // 喜欢的角色类型
    preferredCharacterType?: "温柔学姐" | "傲娇青梅" | "天然学妹";
    // 喜欢的剧情氛围
    preferredMood?: "甜蜜" | "治愈" | "虐心" | "日常";
  };
  
  // === 扩展字段 ===
  custom: Record<string, any>;
}

// 偏好选择节点的输入
export interface PreferenceSelectionInput {
  // 可选：已有的玩家ID（用于加载已存在的偏好）
  playerId?: string;
}

// 偏好选择节点的输出
export interface PreferenceSelectionOutput {
  // 玩家偏好
  preferences: PlayerPreferences;
  // 是否是新玩家
  isNewPlayer: boolean;
  // 成功状态
  success: boolean;
  // 错误信息
  error?: string;
}

// 提示词模板变量
export interface PromptTemplateVariables {
  // 特效相关
  PREFERRED_EFFECT: EffectType;
  EFFECT_NAME: string;
  EFFECT_DESCRIPTION: string;
  SEASON: string;
  
  // 剧情相关
  CHARACTER_TYPE?: string;
  MOOD?: string;
  
  // 扩展
  [key: string]: string | undefined;
}
