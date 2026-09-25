/**
 * 世界相关类型定义
 * 这些是引擎的数据插槽，AI生成的数据将填充这些结构
 */

import type { CharacterInfo } from './character';

/** 世界生成参数 */
export interface WorldGenerationParams {
  /** 语言代码（如 zh-CN, en, ja） */
  language: string;
  /** 主题 */
  theme?: string;
  /** 氛围/特效 */
  atmosphere?: string;
}

/** 世界统计信息 */
export interface WorldStats {
  /** 角色总数 */
  totalCharacters: number;
  /** CG 总数 */
  totalCGs: number;
  /** 章节总数 */
  totalChapters: number;
  /** 已完成结局数 */
  completedEndings: number;
}

/** 存档数据（每个世界一份自动存档） */
export interface SaveData {
  /** 世界ID */
  worldId: string;
  /** 保存时间 */
  savedAt: string;
  /** 当前章节路径（如 "chapter1" | "route_a/chapter2"） */
  currentChapter: string;
  /** 当前脚本行号 */
  currentLine: number;
  /** 已选择的路线（"a" | "b" | "c"） */
  selectedRoute?: string;
  /** 剧情标记 */
  flags: Record<string, unknown>;
}

/** 存档摘要（用于列表展示） */
export interface SaveSummary {
  /** 是否有存档 */
  hasSave: boolean;
  /** 保存时间 */
  savedAt?: string;
  /** 当前章节描述 */
  chapterDesc?: string;
}

/** 世界基本信息（列表展示用） */
export interface WorldInfo {
  /** 世界唯一标识 */
  uid: string;
  /** 世界标题 */
  title: string;
  /** 世界描述 */
  description: string;
  /** 创建时间（ISO字符串） */
  createdAt: string;
  /** 最后游玩时间 */
  lastPlayedAt?: string;
  /** 缩略图路径 */
  thumbnail?: string;
  /** 生成参数 */
  generationParams?: WorldGenerationParams;
  /** 统计信息 */
  stats: WorldStats;
  /** 存档摘要（运行时填充） */
  saveSummary?: SaveSummary;
}

/** 章节配置 */
export interface ChapterConfig {
  id: string;
  title: string;
  script: string;
}

/** 结局配置 */
export interface EndingConfig {
  id: string;
  characterId: string;
  title: string;
}

/** CG 配置 */
export interface CGConfig {
  id: string;
  name: string;
  title?: string;
  chapter: string;
  path: string;
}

/** 游戏配置 */
export interface GameConfig {
  title: string;
  description: string;
  characters: CharacterInfo[];
  chapters: {
    common: ChapterConfig[];
    routes: Record<string, ChapterConfig[]>;
  };
  endings: EndingConfig[];
  cgs: CGConfig[];
  backgrounds: string[];
  bgmTypes?: string[];
}

/** 世界完整配置（加载世界时使用） */
export interface WorldConfig {
  /** 世界唯一标识 */
  uid: string;
  /** 版本 */
  version: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 生成参数 */
  generationParams: WorldGenerationParams;
  /** 游戏配置 */
  game: GameConfig;
  /** 资产配置 */
  assets?: Record<string, unknown>;
  /** 统计信息 */
  stats: WorldStats;
}
