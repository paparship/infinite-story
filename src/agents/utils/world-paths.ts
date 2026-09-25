/**
 * 世界路径工具
 * 
 * 统一管理世界资产的目录结构
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 基础目录 - v2 项目结构
// __dirname = src/agents/utils, 回退3级到 galagame_v2/
const ASSETS_BASE = path.resolve(__dirname, "../../../assets");
const WORLDS_DIR = path.join(ASSETS_BASE, "worlds");
const SHARED_DIR = path.join(ASSETS_BASE, "shared");

/**
 * 世界路径配置
 */
export interface WorldPaths {
  /** 世界唯一标识符 */
  worldId: string;
  /** 世界根目录 */
  baseDir: string;
  /** 剧本目录 */
  storyDir: string;
  /** 角色描述目录 (story/characters/) */
  storyCharactersDir: string;
  /** 角色立绘目录 */
  charactersDir: string;
  /** CG 目录 */
  cgDir: string;
  /** world.json 配置文件路径 */
  worldConfigPath: string;
}

/**
 * 共享资源路径
 */
export interface SharedPaths {
  /** 共享资源根目录 */
  baseDir: string;
  /** 背景图片目录 */
  backgroundsDir: string;
  /** 室内背景 */
  interiorDir: string;
  /** 室外背景 */
  exteriorDir: string;
  /** Schema 目录 */
  schemaDir: string;
}

/**
 * 生成世界 ID
 * 格式: world_{timestamp}_{random}
 */
export function generateWorldId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `world_${timestamp}_${random}`;
}

/**
 * 创建世界路径配置
 * 
 * @param worldId 可选的世界 ID，不提供则自动生成
 * @returns 世界路径配置
 */
export function createWorldPaths(worldId?: string): WorldPaths {
  const id = worldId || generateWorldId();
  const baseDir = path.join(WORLDS_DIR, id);
  
  return {
    worldId: id,
    baseDir,
    storyDir: path.join(baseDir, "story"),
    storyCharactersDir: path.join(baseDir, "story", "characters"),
    charactersDir: path.join(baseDir, "characters"),
    cgDir: path.join(baseDir, "cg"),
    worldConfigPath: path.join(baseDir, "world.json"),
  };
}

/**
 * 获取共享资源路径
 */
export function getSharedPaths(): SharedPaths {
  const baseDir = SHARED_DIR;
  const backgroundsDir = path.join(baseDir, "backgrounds");
  
  return {
    baseDir,
    backgroundsDir,
    interiorDir: path.join(backgroundsDir, "interior"),
    exteriorDir: path.join(backgroundsDir, "exterior"),
    schemaDir: path.join(baseDir, "schema"),
  };
}

/**
 * 确保世界目录结构存在
 */
export function ensureWorldDirs(paths: WorldPaths): void {
  const dirs = [
    paths.baseDir,
    paths.storyDir,
    paths.storyCharactersDir,
    paths.charactersDir,
    paths.cgDir,
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * 获取世界索引路径
 */
export function getWorldsIndexPath(): string {
  return path.join(WORLDS_DIR, "index.json");
}

/**
 * 读取世界索引
 */
export interface WorldIndexEntry {
  uid: string;
  title: string;
  description: string;
  createdAt: string;
  lastPlayedAt: string | null;
  thumbnail: string | null;
  generationParams?: {
    language: string;
    theme: string;
    atmosphere: string;
  };
  stats: {
    totalCharacters: number;
    totalCGs: number;
    playCount: number;
    completedEndings: number;
  };
}

export interface WorldsIndex {
  version: string;
  lastUpdated: string;
  lastPlayedWorldId: string | null;
  worlds: WorldIndexEntry[];
}

/**
 * 读取世界索引
 */
export function readWorldsIndex(): WorldsIndex {
  const indexPath = getWorldsIndexPath();
  
  if (!fs.existsSync(indexPath)) {
    return {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      lastPlayedWorldId: null,
      worlds: [],
    };
  }
  
  return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
}

/**
 * 保存世界索引
 */
export function saveWorldsIndex(index: WorldsIndex): void {
  const indexPath = getWorldsIndexPath();
  const dir = path.dirname(indexPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

/**
 * 添加世界到索引
 */
export function addWorldToIndex(entry: WorldIndexEntry): void {
  const index = readWorldsIndex();
  
  // 检查是否已存在
  const existingIndex = index.worlds.findIndex(w => w.uid === entry.uid);
  if (existingIndex >= 0) {
    index.worlds[existingIndex] = entry;
  } else {
    index.worlds.push(entry);
  }
  
  saveWorldsIndex(index);
}

/**
 * 获取所有世界目录
 */
export function getAllWorldIds(): string[] {
  if (!fs.existsSync(WORLDS_DIR)) {
    return [];
  }
  
  return fs.readdirSync(WORLDS_DIR)
    .filter(name => {
      const worldPath = path.join(WORLDS_DIR, name);
      return fs.statSync(worldPath).isDirectory() && name.startsWith("world_");
    });
}

// 导出目录常量
export { ASSETS_BASE, WORLDS_DIR, SHARED_DIR };
