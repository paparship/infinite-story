/**
 * 玩家偏好持久化存储服务
 * 
 * 将玩家偏好保存到 JSON 文件中
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PlayerPreferences, EffectType, AVAILABLE_EFFECTS } from "../types/player-preferences.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 存储目录
const STORAGE_DIR = path.join(__dirname, "../../data/preferences");

// 确保存储目录存在
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

// 获取玩家偏好文件路径
function getPreferencePath(playerId: string): string {
  return path.join(STORAGE_DIR, `${playerId}.json`);
}

/**
 * 生成新的玩家ID
 */
export function generatePlayerId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `player_${timestamp}_${random}`;
}

/**
 * 创建默认偏好
 */
export function createDefaultPreferences(playerId: string): PlayerPreferences {
  const now = new Date().toISOString();
  return {
    playerId,
    createdAt: now,
    updatedAt: now,
    visual: {
      preferredEffect: "sakura",
      preferredSeason: "春",
    },
    story: {},
    custom: {},
  };
}

/**
 * 保存玩家偏好
 */
export function savePreferences(preferences: PlayerPreferences): void {
  ensureStorageDir();
  
  // 更新时间戳
  preferences.updatedAt = new Date().toISOString();
  
  const filePath = getPreferencePath(preferences.playerId);
  fs.writeFileSync(filePath, JSON.stringify(preferences, null, 2), "utf-8");
  
  console.log(`💾 偏好已保存: ${filePath}`);
}

/**
 * 加载玩家偏好
 */
export function loadPreferences(playerId: string): PlayerPreferences | null {
  const filePath = getPreferencePath(playerId);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as PlayerPreferences;
  } catch (error) {
    console.error(`加载偏好失败: ${error}`);
    return null;
  }
}

/**
 * 检查玩家是否存在
 */
export function playerExists(playerId: string): boolean {
  return fs.existsSync(getPreferencePath(playerId));
}

/**
 * 列出所有玩家
 */
export function listAllPlayers(): string[] {
  ensureStorageDir();
  
  const files = fs.readdirSync(STORAGE_DIR);
  return files
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""));
}

/**
 * 获取当前活跃玩家（最后一个创建/更新的）
 */
export function getActivePlayer(): PlayerPreferences | null {
  const players = listAllPlayers();
  
  if (players.length === 0) {
    return null;
  }
  
  // 找到最近更新的
  let latestPlayer: PlayerPreferences | null = null;
  let latestTime = 0;
  
  for (const playerId of players) {
    const prefs = loadPreferences(playerId);
    if (prefs) {
      const updateTime = new Date(prefs.updatedAt).getTime();
      if (updateTime > latestTime) {
        latestTime = updateTime;
        latestPlayer = prefs;
      }
    }
  }
  
  return latestPlayer;
}

/**
 * 更新特效偏好
 */
export function updateEffectPreference(playerId: string, effect: EffectType): PlayerPreferences {
  let prefs = loadPreferences(playerId);
  
  if (!prefs) {
    prefs = createDefaultPreferences(playerId);
  }
  
  prefs.visual.preferredEffect = effect;
  prefs.visual.preferredSeason = AVAILABLE_EFFECTS[effect].season as any;
  
  savePreferences(prefs);
  return prefs;
}

/**
 * 删除玩家偏好
 */
export function deletePreferences(playerId: string): boolean {
  const filePath = getPreferencePath(playerId);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  
  return false;
}
