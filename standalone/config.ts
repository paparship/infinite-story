/**
 * 独立版游戏配置
 * 用于配置单一世界的路径和游戏信息
 */

export interface StandaloneConfig {
  /** 游戏世界资产路径（相对于 assets 目录） */
  worldPath: string;
  
  /** 存档 key 前缀（避免与其他游戏冲突） */
  saveKeyPrefix: string;
  
  /** 游戏版本号 */
  version: string;
  
  /** 是否显示调试信息 */
  debug: boolean;
}

/**
 * 默认配置
 * 导出时会被替换为实际的游戏配置
 */
export const GAME_CONFIG: StandaloneConfig = {
  // 游戏世界资产路径（作为 worldId 使用）
  // 资产存放在 /assets/worlds/{worldPath}/ 目录
  // 导出脚本会将世界资产复制到 assets/worlds/game/ 目录
  worldPath: 'game',
  
  // 存档 key 前缀（避免与其他游戏冲突）
  // 导出时可以根据游戏名称自定义
  saveKeyPrefix: 'standalone_game_save',
  
  // 版本号
  version: '1.0.0',
  
  // 调试模式（发布时设为 false）
  debug: false,
};

/**
 * 获取完整的资产基础路径
 * 与原版引擎保持一致：/assets/worlds/{worldPath}
 */
export function getAssetBasePath(): string {
  return `/assets/worlds/${GAME_CONFIG.worldPath}`;
}

/**
 * 获取存档 key
 */
export function getSaveKey(): string {
  return GAME_CONFIG.saveKeyPrefix;
}
