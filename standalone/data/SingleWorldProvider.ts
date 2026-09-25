/**
 * 单世界数据提供者
 * 用于独立版游戏，只处理单一世界的数据访问
 */

import type { DataProvider } from '../../src/data/DataProvider';
import type { WorldInfo, WorldConfig, SaveData, SaveSummary } from '../../src/types';
import { GAME_CONFIG, getAssetBasePath, getSaveKey } from '../config';

export class SingleWorldProvider implements DataProvider {
  private worldId: string;
  private basePath: string;
  private worldConfigCache: WorldConfig | null = null;

  constructor() {
    this.worldId = GAME_CONFIG.worldPath;
    this.basePath = getAssetBasePath();
    console.log('[SingleWorldProvider] 初始化，worldPath:', this.worldId, 'basePath:', this.basePath);
  }

  /** 加载世界配置（带缓存） */
  async loadWorldConfig(id?: string): Promise<WorldConfig | null> {
    // 忽略 id 参数，始终使用配置的世界
    if (this.worldConfigCache) return this.worldConfigCache;
    
    try {
      const response = await fetch(`${this.basePath}/world.json`);
      if (!response.ok) {
        console.error('[SingleWorldProvider] 加载世界配置失败:', response.status);
        return null;
      }
      this.worldConfigCache = await response.json();
      return this.worldConfigCache;
    } catch (error) {
      console.error('[SingleWorldProvider] 加载世界配置异常:', error);
      return null;
    }
  }

  /** 将 WorldConfig 转换为 WorldInfo */
  private configToInfo(config: WorldConfig): WorldInfo {
    return {
      uid: this.worldId,
      title: config.game.title,
      description: config.game.description,
      createdAt: config.createdAt,
      generationParams: config.generationParams,
      stats: config.stats,
      saveSummary: this.getSaveSummary(),
    };
  }

  /** 获取存档摘要 */
  private getSaveSummary(): SaveSummary {
    const saveJson = localStorage.getItem(getSaveKey());
    if (!saveJson) {
      return { hasSave: false };
    }
    
    try {
      const save: SaveData = JSON.parse(saveJson);
      // 生成章节描述
      let chapterDesc = '第一章';
      if (save.currentChapter.includes('route_a')) {
        chapterDesc = save.currentChapter.includes('chapter3') ? '结局 A' : '第二章 路线A';
      } else if (save.currentChapter.includes('route_b')) {
        chapterDesc = save.currentChapter.includes('chapter3') ? '结局 B' : '第二章 路线B';
      } else if (save.currentChapter.includes('route_c')) {
        chapterDesc = save.currentChapter.includes('chapter3') ? '结局 C' : '第二章 路线C';
      }
      
      return {
        hasSave: true,
        savedAt: save.savedAt,
        chapterDesc,
      };
    } catch {
      return { hasSave: false };
    }
  }

  /** 获取世界列表（始终返回单一世界） */
  async getWorldList(): Promise<WorldInfo[]> {
    console.log('[SingleWorldProvider] 获取世界列表');
    const config = await this.loadWorldConfig();
    if (!config) return [];
    return [this.configToInfo(config)];
  }

  /** 根据 ID 获取世界信息（忽略 ID，返回配置的世界） */
  async getWorldById(id: string): Promise<WorldInfo | null> {
    console.log('[SingleWorldProvider] 获取世界:', id);
    const config = await this.loadWorldConfig();
    if (!config) return null;
    return this.configToInfo(config);
  }

  /** 获取存档数据 */
  async getSaveData(worldId: string): Promise<SaveData | null> {
    console.log('[SingleWorldProvider] 获取存档');
    const saveJson = localStorage.getItem(getSaveKey());
    if (!saveJson) return null;
    
    try {
      return JSON.parse(saveJson);
    } catch {
      return null;
    }
  }

  /** 保存存档数据 */
  async saveSaveData(worldId: string, data: SaveData): Promise<void> {
    console.log('[SingleWorldProvider] 保存存档');
    // 覆盖 worldId 为配置的世界 ID
    const saveData = { ...data, worldId: this.worldId };
    localStorage.setItem(getSaveKey(), JSON.stringify(saveData));
  }

  /** 删除存档数据 */
  async deleteSaveData(worldId: string): Promise<void> {
    console.log('[SingleWorldProvider] 删除存档');
    localStorage.removeItem(getSaveKey());
  }

  /** 删除世界（独立版不支持） */
  async deleteWorld(worldId: string): Promise<boolean> {
    console.warn('[SingleWorldProvider] 独立版不支持删除世界');
    return false;
  }

  /** 获取世界数量（始终为 1） */
  async getWorldCount(): Promise<number> {
    return 1;
  }

  /** 获取最大世界数量（独立版为 1） */
  async getMaxWorlds(): Promise<number> {
    return 1;
  }

  /** 检查是否有存档 */
  hasSave(): boolean {
    return localStorage.getItem(getSaveKey()) !== null;
  }

  /** 获取配置的世界 ID */
  getWorldId(): string {
    return this.worldId;
  }

  /** 获取资产基础路径 */
  getBasePath(): string {
    return this.basePath;
  }
}
