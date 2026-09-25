/**
 * 游戏状态管理
 * 统一管理游戏进度、路线选择、存档等状态
 */

/** 路线标识 */
export type RouteId = 'a' | 'b' | 'c';

/** 章节类型 */
export type ChapterType = 'common' | 'route';

/** 游戏状态接口 */
export interface GameState {
  // 世界信息
  worldId: string;
  
  // 进度状态
  currentChapter: string;      // 当前章节文件名（如 'chapter1', 'route_a/chapter2'）
  currentLine: number;         // 当前行号
  
  // 路线状态
  selectedRoute: RouteId | null;  // 已选择的路线（null 表示共通线）
  chapterIndex: number;           // 章节序号（0=共通线chapter1, 1=路线chapter2, 2=路线chapter3）
  
  // 选择记录（用于回溯和统计）
  choices: ChoiceRecord[];
  
  // 解锁记录
  unlockedCGs: string[];
  unlockedEndings: string[];
  
  // 游戏标志
  flags: Record<string, unknown>;
}

/** 选择记录 */
export interface ChoiceRecord {
  chapter: string;
  line: number;
  optionIndex: number;
  timestamp: number;
}

/** 创建初始游戏状态 */
export function createInitialState(worldId: string, chapter: string = 'chapter1', line: number = 0): GameState {
  return {
    worldId,
    currentChapter: chapter,
    currentLine: line,
    selectedRoute: null,
    chapterIndex: 0,
    choices: [],
    unlockedCGs: [],
    unlockedEndings: [],
    flags: {},
  };
}

/** 路线映射：选项索引 -> 路线 ID */
export const ROUTE_MAP: Record<number, RouteId> = {
  1: 'a',
  2: 'b',
  3: 'c',
};

/** 获取下一章节路径 */
export function getNextChapterPath(state: GameState): string | null {
  // 如果还在共通线（chapter1），需要先选择路线
  if (state.chapterIndex === 0) {
    if (!state.selectedRoute) {
      console.warn('[GameState] 共通线结束但未选择路线');
      return null;
    }
    // 进入路线的第二章
    return `route_${state.selectedRoute}/chapter2`;
  }
  
  // 路线章节递进
  if (state.chapterIndex === 1) {
    // 从 chapter2 -> chapter3
    return `route_${state.selectedRoute}/chapter3`;
  }
  
  // chapter3 是结局，没有下一章
  return null;
}

/** 检查是否为路线分支选项（共通线末尾的三选一） */
export function isRouteBranchChoice(state: GameState, optionCount: number, forceRouteBranch?: boolean): boolean {
  // 关键：路线选择只能在第一章（共通线）发生
  // 如果已经选择了路线，后续章节的【关键选择】不应触发路线切换
  if (state.chapterIndex !== 0 || state.selectedRoute !== null) {
    return false;
  }
  
  // 只有脚本明确标记为路线分支（【关键选择】）时才触发路线选择
  // 移除旧的 optionCount === 3 兼容逻辑，避免普通【选项】被误判
  return forceRouteBranch === true;
}

/** 更新状态：选择选项 */
export function applyChoice(state: GameState, optionIndex: number, optionCount: number, isRouteBranch?: boolean): GameState {
  const newState = { ...state };
  
  // 记录选择
  newState.choices = [
    ...state.choices,
    {
      chapter: state.currentChapter,
      line: state.currentLine,
      optionIndex,
      timestamp: Date.now(),
    },
  ];
  
  // 检查是否为路线分支选择
  if (isRouteBranchChoice(state, optionCount, isRouteBranch)) {
    const route = ROUTE_MAP[optionIndex];
    if (route) {
      newState.selectedRoute = route;
      console.log(`[GameState] 选择路线: ${route}`);
    } else {
      console.warn(`[GameState] 无效的路线选项索引: ${optionIndex}`);
    }
  }
  
  return newState;
}

/** 更新状态：章节结束，进入下一章 */
export function advanceChapter(state: GameState): GameState {
  const nextPath = getNextChapterPath(state);
  
  if (!nextPath) {
    console.log('[GameState] 已到达结局，无下一章');
    return state;
  }
  
  return {
    ...state,
    currentChapter: nextPath,
    currentLine: 0,
    chapterIndex: state.chapterIndex + 1,
  };
}

/** 更新状态：解锁 CG */
export function unlockCG(state: GameState, cgId: string): GameState {
  if (state.unlockedCGs.includes(cgId)) {
    return state;
  }
  
  return {
    ...state,
    unlockedCGs: [...state.unlockedCGs, cgId],
  };
}

/** 更新状态：解锁结局 */
export function unlockEnding(state: GameState, endingId: string): GameState {
  if (state.unlockedEndings.includes(endingId)) {
    return state;
  }
  
  return {
    ...state,
    unlockedEndings: [...state.unlockedEndings, endingId],
  };
}

/** 存档数据格式（与 types/world.ts SaveData 兼容） */
export interface GameSaveData {
  worldId: string;
  savedAt: string;
  currentChapter: string;
  currentLine: number;
  selectedRoute?: string;
  chapterIndex?: number;
  choices?: ChoiceRecord[];
  unlockedCGs?: string[];
  unlockedEndings?: string[];
  flags: Record<string, unknown>;
}

/** 转换为存档格式 */
export function toSaveData(state: GameState): GameSaveData {
  return {
    worldId: state.worldId,
    savedAt: new Date().toISOString(),
    currentChapter: state.currentChapter,
    currentLine: state.currentLine,
    selectedRoute: state.selectedRoute || undefined,
    chapterIndex: state.chapterIndex,
    choices: state.choices,
    unlockedCGs: state.unlockedCGs,
    unlockedEndings: state.unlockedEndings,
    flags: state.flags,
  };
}

/** 从存档恢复状态 */
export function fromSaveData(saveData: Record<string, unknown>): GameState {
  return {
    worldId: saveData.worldId as string,
    currentChapter: saveData.currentChapter as string,
    currentLine: saveData.currentLine as number,
    selectedRoute: saveData.selectedRoute as RouteId | null,
    chapterIndex: saveData.chapterIndex as number || 0,
    choices: (saveData.choices as ChoiceRecord[]) || [],
    unlockedCGs: (saveData.unlockedCGs as string[]) || [],
    unlockedEndings: (saveData.unlockedEndings as string[]) || [],
    flags: (saveData.flags as Record<string, unknown>) || {},
  };
}
