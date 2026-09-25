/**
 * Mock 数据提供者
 * 用于开发和测试，提供假数据
 */

import type { DataProvider } from './DataProvider';
import type { WorldInfo, WorldConfig, SaveData } from '../types';

/** Mock 世界数据 */
const MOCK_WORLDS: WorldInfo[] = [
  {
    uid: 'world_mock_001',
    title: '樱花树下的约定',
    description: '在春天的校园里，一段青涩的恋情悄然萌芽...',
    createdAt: '2024-01-15T10:30:00Z',
    lastPlayedAt: '2024-01-20T15:00:00Z',
    generationParams: { language: 'zh-CN', atmosphere: 'sakura' },
    stats: { totalCharacters: 3, totalCGs: 12, totalChapters: 5, completedEndings: 0 },
    saveSummary: { hasSave: true, savedAt: '2024-01-20T15:00:00Z', chapterDesc: '第二章 林夏线' },
  },
  {
    uid: 'world_mock_002',
    title: '星空下的告白',
    description: '夏日祭典的夜晚，烟花绽放的瞬间...',
    createdAt: '2024-01-10T08:00:00Z',
    generationParams: { language: 'zh-CN', atmosphere: 'stars' },
    stats: { totalCharacters: 4, totalCGs: 15, totalChapters: 6, completedEndings: 1 },
    saveSummary: { hasSave: false },
  },
  {
    uid: 'world_mock_003',
    title: 'Rainy Season Memories',
    description: 'A bittersweet story in the rainy season...',
    createdAt: '2024-01-05T12:00:00Z',
    generationParams: { language: 'en', atmosphere: 'rain' },
    stats: { totalCharacters: 3, totalCGs: 10, totalChapters: 4, completedEndings: 0 },
    saveSummary: { hasSave: false },
  },
];

/** Mock 存档数据 */
const mockSaves: Map<string, SaveData> = new Map([
  ['world_mock_001', {
    worldId: 'world_mock_001',
    savedAt: '2024-01-20T15:00:00Z',
    currentChapter: 'route_a/chapter2',
    currentLine: 42,
    selectedRoute: 'a',
    flags: {},
  }],
]);

export class MockDataProvider implements DataProvider {
  async getWorldList(): Promise<WorldInfo[]> {
    console.log('[MockDataProvider] 获取世界列表');
    await this.delay(300);
    return [...MOCK_WORLDS];
  }

  async getWorldById(id: string): Promise<WorldInfo | null> {
    console.log(`[MockDataProvider] 获取世界: ${id}`);
    await this.delay(100);
    return MOCK_WORLDS.find(w => w.uid === id) || null;
  }

  async loadWorldConfig(id: string): Promise<WorldConfig | null> {
    console.log(`[MockDataProvider] 加载世界配置: ${id}`);
    await this.delay(200);
    
    const world = MOCK_WORLDS.find(w => w.uid === id);
    if (!world) return null;

    return {
      uid: world.uid,
      version: '1.0.0',
      createdAt: world.createdAt,
      updatedAt: world.createdAt,
      generationParams: world.generationParams || { language: 'zh-CN' },
      characters: [
        { id: 'char_1', name: '角色A', color: '#FFB7C5', expressions: ['default', 'happy', 'sad'] },
        { id: 'char_2', name: '角色B', color: '#87CEEB', expressions: ['default', 'happy', 'angry'] },
      ],
      stats: world.stats,
    };
  }

  async getSaveData(worldId: string): Promise<SaveData | null> {
    console.log(`[MockDataProvider] 获取存档: ${worldId}`);
    await this.delay(100);
    return mockSaves.get(worldId) || null;
  }

  async saveSaveData(worldId: string, data: SaveData): Promise<void> {
    console.log(`[MockDataProvider] 保存存档: ${worldId}`);
    await this.delay(100);
    mockSaves.set(worldId, data);
  }

  async deleteSaveData(worldId: string): Promise<void> {
    console.log(`[MockDataProvider] 删除存档: ${worldId}`);
    await this.delay(100);
    mockSaves.delete(worldId);
  }

  async deleteWorld(worldId: string): Promise<boolean> {
    console.log(`[MockDataProvider] 删除世界: ${worldId}`);
    await this.delay(100);
    const index = MOCK_WORLDS.findIndex(w => w.uid === worldId);
    if (index >= 0) {
      MOCK_WORLDS.splice(index, 1);
      mockSaves.delete(worldId);
      return true;
    }
    return false;
  }

  async getWorldCount(): Promise<number> {
    return MOCK_WORLDS.length;
  }

  async getMaxWorlds(): Promise<number> {
    return 10;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
