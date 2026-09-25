/**
 * 数据提供者接口
 * 定义引擎获取数据的抽象接口，具体实现可以是 Mock、文件系统、API 等
 */

import type { WorldInfo, WorldConfig, SaveData } from '../types';

/** 世界索引信息 */
export interface WorldIndex {
  version: string;
  lastUpdated: string;
  lastPlayedWorldId: string | null;
  maxWorlds: number;
  worlds: WorldInfo[];
}

/** 数据提供者接口 */
export interface DataProvider {
  /** 获取所有可用世界列表（含存档摘要） */
  getWorldList(): Promise<WorldInfo[]>;
  
  /** 根据ID获取世界基本信息 */
  getWorldById(id: string): Promise<WorldInfo | null>;
  
  /** 加载世界完整配置 */
  loadWorldConfig(id: string): Promise<WorldConfig | null>;
  
  /** 获取世界存档 */
  getSaveData(worldId: string): Promise<SaveData | null>;
  
  /** 保存游戏进度 */
  saveSaveData(worldId: string, data: SaveData): Promise<void>;
  
  /** 删除存档 */
  deleteSaveData(worldId: string): Promise<void>;
  
  /** 删除整个世界（资产+存档） */
  deleteWorld(worldId: string): Promise<boolean>;
  
  /** 获取当前世界数量 */
  getWorldCount(): Promise<number>;
  
  /** 获取最大世界数量限制 */
  getMaxWorlds(): Promise<number>;
}

/** 数据提供者工厂类型 */
export type DataProviderFactory = () => DataProvider;
