/**
 * 游戏内容加载器
 * 负责世界配置与脚本加载，避免 GameScreen 承担数据加载细节
 */

import type { DataProvider } from '../data/DataProvider';
import type { WorldConfig, CharacterInfo } from '../types';
import { ScriptParser, type ScriptCommand } from './ScriptParser';

export interface WorldLoadResult {
  worldConfig: WorldConfig;
  characterMap: Map<string, CharacterInfo & { folder: string; sprites?: Record<string, string> }>;
  basePath: string;
}

export class GameContentLoader {
  private baseUrl: string;
  private dataProvider: DataProvider;

  constructor(dataProvider: DataProvider, baseUrl: string = '/assets/worlds') {
    this.dataProvider = dataProvider;
    this.baseUrl = baseUrl;
  }

  async loadWorld(worldId: string): Promise<WorldLoadResult | null> {
    try {
      const worldConfig = await this.dataProvider.loadWorldConfig(worldId);
      if (!worldConfig) {
        console.error('[GameContentLoader] 无法加载世界配置');
        return null;
      }
      console.log(`[GameContentLoader] 加载世界: ${worldConfig.game.title}`);

      const assetsByName = new Map<string, Record<string, string>>();
      const assetCharacters = worldConfig.assets?.characters || {};
      Object.values(assetCharacters).forEach(asset => {
        const name = (asset as { name?: string; sprites?: Record<string, string> }).name;
        const sprites = (asset as { sprites?: Record<string, string> }).sprites;
        if (name && sprites) {
          assetsByName.set(name, sprites);
        }
      });

      const characterMap = new Map<string, CharacterInfo & { folder: string; sprites?: Record<string, string> }>();
      worldConfig.game.characters.forEach(char => {
        characterMap.set(char.name, {
          ...char,
          sprites: assetsByName.get(char.name),
        } as CharacterInfo & { folder: string; sprites?: Record<string, string> });
      });

      return {
        worldConfig,
        characterMap,
        basePath: `${this.baseUrl}/${worldId}`,
      };
    } catch (error) {
      console.error('[GameContentLoader] 加载世界失败:', error);
      return null;
    }
  }

  private getScriptPath(worldId: string, chapter: string): string {
    return `${this.baseUrl}/${worldId}/story/${chapter}.txt`;
  }

  async loadScript(worldId: string, chapter: string): Promise<ScriptCommand[] | null> {
    try {
      const scriptPath = this.getScriptPath(worldId, chapter);
      console.log(`[GameContentLoader] 加载脚本: ${scriptPath}`);

      const response = await fetch(scriptPath);
      if (!response.ok) {
        throw new Error(`Failed to load script: ${response.status}`);
      }

      const scriptText = await response.text();
      const result = ScriptParser.parse(scriptText);
      console.log(`[GameContentLoader] 脚本加载完成: ${result.commands.length} 条指令`);
      return result.commands;
    } catch (error) {
      console.error('[GameContentLoader] 加载脚本失败:', error);
      return null;
    }
  }
}
