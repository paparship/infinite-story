/**
 * 文件数据提供者
 * 从本地文件系统（通过 HTTP）读取世界数据
 */

import type { DataProvider, WorldIndex } from './DataProvider';
import type { WorldInfo, WorldConfig, SaveData, SaveSummary } from '../types';

/** 存档存储 key 前缀 */
const SAVE_KEY_PREFIX = 'galagame_save_';

export class FileDataProvider implements DataProvider {
  private baseUrl: string;
  private indexCache: WorldIndex | null = null;

  constructor(baseUrl: string = '/assets/worlds') {
    this.baseUrl = baseUrl;
    console.log('[FileDataProvider] 初始化，baseUrl:', baseUrl);
  }

  /** 获取索引（带缓存） */
  private async getIndex(): Promise<WorldIndex> {
    if (this.indexCache) return this.indexCache;
    
    const response = await fetch(`${this.baseUrl}/index.json`);
    if (!response.ok) {
      throw new Error(`Failed to load index: ${response.status}`);
    }
    this.indexCache = await response.json();
    return this.indexCache!;
  }

  /** 刷新索引缓存 */
  private invalidateCache(): void {
    this.indexCache = null;
  }

  /** 获取存档摘要 */
  private async getSaveSummary(worldId: string, worldConfig?: WorldConfig | null): Promise<SaveSummary> {
    const saveJson = localStorage.getItem(SAVE_KEY_PREFIX + worldId);
    if (!saveJson) {
      return { hasSave: false };
    }

    try {
      const save: SaveData = JSON.parse(saveJson);
      const resolvedConfig = worldConfig ?? await this.loadWorldConfig(worldId);
      const chapterDesc = this.buildChapterDesc(save, resolvedConfig);

      return {
        hasSave: true,
        savedAt: save.savedAt,
        chapterDesc,
      };
    } catch {
      return { hasSave: false };
    }
  }

  private buildChapterDesc(save: SaveData, worldConfig?: WorldConfig | null): string {
    const chapterKey = save.currentChapter || '';
    const routeKey = chapterKey.match(/route_[abc]/)?.[0];
    const chapterId = chapterKey.match(/chapter\\d+/)?.[0];

    if (!routeKey) {
      const commonChapters = worldConfig?.game?.chapters?.common || [];
      if (chapterId) {
        const match = commonChapters.find(chapter => chapter.id === chapterId);
        if (match?.title) return match.title;
      }
      return commonChapters[0]?.title || '第一章';
    }

    const routes = worldConfig?.game?.chapters?.routes || {};
    for (const chapters of Object.values(routes)) {
      const match = chapters.find(chapter => {
        const script = chapter.script || '';
        if (chapterKey && script.includes(chapterKey)) return true;
        const routeMatch = script.includes(routeKey);
        const chapterMatch = chapterId ? script.includes(chapterId) : false;
        return routeMatch && chapterMatch;
      });
      if (match?.title) return match.title;
    }

    const routeLabel = routeKey.replace('route_', '').toUpperCase();
    const chapterNum = chapterId?.replace('chapter', '');
    if (chapterNum) {
      return `第${chapterNum}章 线路${routeLabel}`;
    }
    return `线路${routeLabel}`;
  }

  async getWorldList(): Promise<WorldInfo[]> {
    console.log('[FileDataProvider] 获取世界列表');
    const index = await this.getIndex();
    
    // 为每个世界附加存档摘要，并按创建时间降序排列（新的在前）
    const worlds = await Promise.all(index.worlds.map(async world => {
      const config = await this.loadWorldConfig(world.uid);
      const saveSummary = await this.getSaveSummary(world.uid, config);
      return {
        ...world,
        saveSummary,
      };
    }));
    
    // 从 world ID (world_<timestamp>_<random>) 提取时间戳排序
    return worlds.sort((a, b) => {
      const tsA = parseInt(a.uid.split('_')[1] || '0', 10);
      const tsB = parseInt(b.uid.split('_')[1] || '0', 10);
      return tsB - tsA; // 降序，新的在前
    });
  }

  async getWorldById(id: string): Promise<WorldInfo | null> {
    console.log('[FileDataProvider] 获取世界:', id);
    const index = await this.getIndex();
    const world = index.worlds.find(w => w.uid === id);
    if (!world) return null;
    
    const config = await this.loadWorldConfig(world.uid);
    const saveSummary = await this.getSaveSummary(world.uid, config);
    return {
      ...world,
      saveSummary,
    };
  }

  async loadWorldConfig(id: string): Promise<WorldConfig | null> {
    console.log('[FileDataProvider] 加载世界配置:', id);
    try {
      const response = await fetch(`${this.baseUrl}/${id}/world.json`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('[FileDataProvider] 加载世界配置失败:', error);
      return null;
    }
  }

  async getSaveData(worldId: string): Promise<SaveData | null> {
    console.log('[FileDataProvider] 获取存档:', worldId);
    const saveJson = localStorage.getItem(SAVE_KEY_PREFIX + worldId);
    if (!saveJson) return null;
    
    try {
      return JSON.parse(saveJson);
    } catch {
      return null;
    }
  }

  async saveSaveData(worldId: string, data: SaveData): Promise<void> {
    console.log('[FileDataProvider] 保存存档:', worldId);
    localStorage.setItem(SAVE_KEY_PREFIX + worldId, JSON.stringify(data));
  }

  async deleteSaveData(worldId: string): Promise<void> {
    console.log('[FileDataProvider] 删除存档:', worldId);
    localStorage.removeItem(SAVE_KEY_PREFIX + worldId);
  }

  async deleteWorld(worldId: string): Promise<boolean> {
    console.log('[FileDataProvider] 删除世界:', worldId);
    // 注意：前端无法直接删除服务器文件
    // 这里只删除本地存档，真正删除资产需要后端支持
    // 目前只从索引中标记删除（实际删除需手动或后端API）
    
    // 删除本地存档
    localStorage.removeItem(SAVE_KEY_PREFIX + worldId);
    
    // 从缓存中移除
    if (this.indexCache) {
      this.indexCache.worlds = this.indexCache.worlds.filter(w => w.uid !== worldId);
    }
    
    // TODO: 实际删除需要后端 API 支持
    console.warn('[FileDataProvider] 世界资产删除需要后端支持，当前仅删除本地存档');
    return true;
  }

  async getWorldCount(): Promise<number> {
    const index = await this.getIndex();
    return index.worlds.length;
  }

  async getMaxWorlds(): Promise<number> {
    const index = await this.getIndex();
    return index.maxWorlds || 10;
  }
}
