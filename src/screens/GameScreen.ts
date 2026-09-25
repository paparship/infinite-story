/**
 * 游戏主界面
 * 管理对话、角色、背景、CG、特效等所有游戏元素
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';
import type { DataProvider } from '../data/DataProvider';
import type { WorldConfig, SaveData } from '../types';
import { type ScriptCommand, type ChoiceOption } from '../core/ScriptParser';
import { GameContentLoader } from '../core/GameContentLoader';
import { GameRenderExecutor } from '../core/GameRenderExecutor';
import { GameResourceManager } from '../core/GameResourceManager';
import { DialogueBox } from '../ui/DialogueBox';
import { CharacterDisplay } from '../ui/CharacterDisplay';
import { ChoicePanel } from '../ui/ChoicePanel';
import { EffectManager } from '../ui/EffectManager';
import { GameInputController } from '../core/GameInputController';
import { GameCommandExecutor } from '../core/GameCommandExecutor';
import {
  type GameState,
  createInitialState,
  applyChoice,
  advanceChapter,
  getNextChapterPath,
  toSaveData,
  fromSaveData,
} from '../core/GameState';

/** 游戏启动参数 */
export interface GameParams {
  worldId: string;
  chapter: string;
  line?: number;
  fromSave?: boolean;
}

/** 渲染层级深度 */
const DEPTH = {
  BACKGROUND: 0,
  CHARACTER_LEFT: 10,
  CHARACTER_CENTER: 11,
  CHARACTER_RIGHT: 12,
  EFFECT: 20,
  CG: 50,
  DIALOGUE: 100,
  CHOICE: 110,
  MENU: 200,
};

export class GameScreen implements BaseScreen {
  readonly name = 'game';
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;
  private dataProvider: DataProvider;
  private contentLoader: GameContentLoader;
  private inputController: GameInputController;
  private commandExecutor: GameCommandExecutor;
  private renderExecutor: GameRenderExecutor;
  private resourceManager: GameResourceManager;

  // 世界数据
  private worldConfig: WorldConfig | null = null;
  private worldBasePath: string | null = null;

  // 游戏状态（统一管理）
  private gameState!: GameState;

  // 脚本状态
  private commands: ScriptCommand[] = [];
  private isWaitingForInput: boolean = false;
  private isAnimating: boolean = false;
  
  // 当前选项信息（用于判断路线分支）
  private currentChoiceCount: number = 0;
  private isCurrentChoiceRouteBranch: boolean = false;

  // 渲染层
  private bgLayer!: Phaser.GameObjects.Container;
  private charLayer!: Phaser.GameObjects.Container;
  private effectLayer!: Phaser.GameObjects.Container;
  private cgLayer!: Phaser.GameObjects.Container;
  private dialogueLayer!: Phaser.GameObjects.Container;
  private choiceLayer!: Phaser.GameObjects.Container;

  // UI 组件
  private dialogueBox!: DialogueBox;
  private characterDisplay!: CharacterDisplay;
  private choicePanel!: ChoicePanel;
  private effectManager!: EffectManager;

  // 当前状态
  private currentBg: Phaser.GameObjects.Image | null = null;
  private currentCG: Phaser.GameObjects.Image | null = null;
  private currentCGTitle: Phaser.GameObjects.Text | null = null;
  private lastCharacterName: string = '';  // 追踪最后显示的角色名
  private loadedTextures: string[] = [];
  
  // CG 锁定（显示后 2 秒内不允许跳过）
  private cgLockUntil: number = 0;

  constructor(scene: Phaser.Scene, screenManager: ScreenManager, dataProvider: DataProvider) {
    this.scene = scene;
    this.screenManager = screenManager;
    this.dataProvider = dataProvider;
    this.contentLoader = new GameContentLoader(dataProvider);
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(100);
    this.container.setVisible(false);

    this.createLayers();
    this.createUI();
    this.inputController = new GameInputController(this.scene, {
      isActive: () => this.container.visible,
      isChoiceVisible: () => this.choicePanel.isVisible(),
      isCgLocked: () => Date.now() < this.cgLockUntil,
      isTyping: () => this.dialogueBox.isTyping(),
      completeTyping: () => this.dialogueBox.completeTyping(),
      isWaitingForInput: () => this.isWaitingForInput,
      isAnimating: () => this.isAnimating,
      advanceLine: () => this.advanceLine(),
      executeCurrentCommand: () => this.executeCurrentCommand(),
      exitGame: () => this.exitGame(),
    });
    this.renderExecutor = new GameRenderExecutor({
      scene: this.scene,
      container: this.container,
      bgLayer: this.bgLayer,
      charLayer: this.charLayer,
      cgLayer: this.cgLayer,
      effectManager: this.effectManager,
      dialogueBox: this.dialogueBox,
      characterDisplay: this.characterDisplay,
      choicePanel: this.choicePanel,
      getWorldConfig: () => this.worldConfig,
      getWorldBasePath: () => this.worldBasePath,
      getGameState: () => this.gameState,
      setGameState: state => {
        this.gameState = state;
      },
      getCurrentBg: () => this.currentBg,
      setCurrentBg: bg => {
        this.currentBg = bg;
      },
      getCurrentCG: () => this.currentCG,
      setCurrentCG: cg => {
        this.currentCG = cg;
      },
      getCurrentCGTitle: () => this.currentCGTitle,
      setCurrentCGTitle: title => {
        this.currentCGTitle = title;
      },
      getLastCharacterName: () => this.lastCharacterName,
      setLastCharacterName: name => {
        this.lastCharacterName = name;
      },
      addLoadedTexture: key => {
        this.loadedTextures.push(key);
      },
      setCgLockUntil: value => {
        this.cgLockUntil = value;
      },
      setWaitingForInput: value => {
        this.isWaitingForInput = value;
      },
      setCurrentChoiceCount: value => {
        this.currentChoiceCount = value;
      },
      setIsCurrentChoiceRouteBranch: value => {
        this.isCurrentChoiceRouteBranch = value;
      },
      advanceLine: () => this.advanceLine(),
      executeCurrentCommand: () => this.executeCurrentCommand(),
      titleDepth: DEPTH.CG + 1,
    });
    this.resourceManager = new GameResourceManager({
      scene: this.scene,
      dialogueBox: this.dialogueBox,
      choicePanel: this.choicePanel,
      characterDisplay: this.characterDisplay,
      effectManager: this.effectManager,
      getLoadedTextures: () => this.loadedTextures,
      clearLoadedTextures: () => {
        this.loadedTextures = [];
      },
      getCurrentBg: () => this.currentBg,
      setCurrentBg: bg => {
        this.currentBg = bg;
      },
      getCurrentCG: () => this.currentCG,
      setCurrentCG: cg => {
        this.currentCG = cg;
      },
      getCurrentCGTitle: () => this.currentCGTitle,
      setCurrentCGTitle: title => {
        this.currentCGTitle = title;
      },
    });
    this.commandExecutor = new GameCommandExecutor({
      getCurrentLine: () => this.gameState.currentLine,
      getCommands: () => this.commands,
      setWaitingForInput: value => {
        this.isWaitingForInput = value;
      },
      advanceLine: () => this.advanceLine(),
      onScriptEnd: () => this.onScriptEnd(),
      handlers: {
        background: id => this.renderExecutor.executeBackground(id),
        character: params => this.renderExecutor.executeCharacter(params),
        hide: name => this.renderExecutor.executeHideCharacter(name),
        dialogue: (name, text) => this.renderExecutor.executeDialogue(name, text),
        narration: text => this.renderExecutor.executeNarration(text),
        choice: (options, isRouteBranch) => this.renderExecutor.executeChoice(options, isRouteBranch),
        cg: (id, title) => this.renderExecutor.executeCG(id, title),
        shake: () => this.renderExecutor.executeShake(),
        clear: () => this.renderExecutor.executeClear(),
        effect: effectType => this.renderExecutor.executeEffect(effectType),
        title: title => this.renderExecutor.executeTitle(title),
        end: isGame => this.onChapterEnd(isGame),
      },
    });
  }

  /** 创建渲染层 */
  private createLayers(): void {
    // 背景层
    this.bgLayer = this.scene.add.container(0, 0);
    this.bgLayer.setDepth(DEPTH.BACKGROUND);
    this.container.add(this.bgLayer);

    // 角色层
    this.charLayer = this.scene.add.container(0, 0);
    this.charLayer.setDepth(DEPTH.CHARACTER_CENTER);
    this.container.add(this.charLayer);

    // 特效层
    this.effectLayer = this.scene.add.container(0, 0);
    this.effectLayer.setDepth(DEPTH.EFFECT);
    this.container.add(this.effectLayer);

    // CG 层
    this.cgLayer = this.scene.add.container(0, 0);
    this.cgLayer.setDepth(DEPTH.CG);
    this.container.add(this.cgLayer);

    // 对话层
    this.dialogueLayer = this.scene.add.container(0, 0);
    this.dialogueLayer.setDepth(DEPTH.DIALOGUE);
    this.container.add(this.dialogueLayer);

    // 选项层
    this.choiceLayer = this.scene.add.container(0, 0);
    this.choiceLayer.setDepth(DEPTH.CHOICE);
    this.container.add(this.choiceLayer);
  }

  /** 创建 UI 组件 */
  private createUI(): void {
    // 对话框
    this.dialogueBox = new DialogueBox(this.scene, this.dialogueLayer);
    
    // 角色显示
    this.characterDisplay = new CharacterDisplay(this.scene, this.charLayer);
    
    // 选项面板
    this.choicePanel = new ChoicePanel(this.scene, this.choiceLayer, (index: number) => {
      this.onChoiceSelected(index);
    });
    
    // 特效管理器
    this.effectManager = new EffectManager(this.scene, this.effectLayer);
  }


  /** 推进行号 */
  private advanceLine(): void {
    this.gameState = {
      ...this.gameState,
      currentLine: this.gameState.currentLine + 1,
    };
  }

  /** 选项选择回调 */
  private onChoiceSelected(index: number): void {
    console.log(`[GameScreen] 选择选项: ${index}, 路线分支: ${this.isCurrentChoiceRouteBranch}`);
    this.choicePanel.hide();
    
    // 应用选择（可能会设置路线）
    this.gameState = applyChoice(this.gameState, index, this.currentChoiceCount, this.isCurrentChoiceRouteBranch);
    
    // 继续执行
    this.advanceLine();
    this.executeCurrentCommand();
  }

  private async loadWorldAndScript(): Promise<boolean> {
    const worldResult = await this.contentLoader.loadWorld(this.gameState.worldId);
    if (worldResult) {
      this.worldConfig = worldResult.worldConfig;
      this.worldBasePath = worldResult.basePath;
      this.characterDisplay.setCharacterMap(worldResult.characterMap, worldResult.basePath);
    }

    const commands = await this.contentLoader.loadScript(this.gameState.worldId, this.gameState.currentChapter);
    if (!commands) {
      return false;
    }
    this.commands = commands;
    return true;
  }

  /** 执行当前指令 */
  private executeCurrentCommand(): void {
    this.commandExecutor.executeCurrentCommand();
  }


  /** 章节结束 */
  private async onChapterEnd(isGame: boolean): Promise<void> {
    console.log(`[GameScreen] 章节结束, isGame: ${isGame}, route: ${this.gameState.selectedRoute}`);
    
    if (isGame) {
      // 游戏结束（结局），返回标题
      this.saveProgress();
      this.exitGame();
      return;
    }
    
    // 检查是否有下一章
    const nextPath = getNextChapterPath(this.gameState);
    if (!nextPath) {
      console.log('[GameScreen] 无下一章（未选择路线或已到结局）');
      this.exitGame();
      return;
    }
    
    // 更新状态并加载下一章
    this.gameState = advanceChapter(this.gameState);
    console.log(`[GameScreen] 进入下一章: ${this.gameState.currentChapter}`);
    
    // 保存进度
    this.saveProgress();
    
    // 加载新章节脚本
    const commands = await this.contentLoader.loadScript(this.gameState.worldId, this.gameState.currentChapter);
    if (commands) {
      this.commands = commands;
      this.executeCurrentCommand();
    } else {
      console.error('[GameScreen] 加载下一章失败');
      this.exitGame();
    }
  }

  /** 保存游戏进度 */
  private async saveProgress(): Promise<void> {
    try {
      const gameSaveData = toSaveData(this.gameState);
      // 转换为 SaveData 格式（GameSaveData 是 SaveData 的超集）
      const saveData: SaveData = {
        worldId: gameSaveData.worldId,
        savedAt: gameSaveData.savedAt,
        currentChapter: gameSaveData.currentChapter,
        currentLine: gameSaveData.currentLine,
        selectedRoute: gameSaveData.selectedRoute,
        flags: gameSaveData.flags,
      };
      await this.dataProvider.saveSaveData(this.gameState.worldId, saveData);
      console.log('[GameScreen] 进度已保存');
    } catch (error) {
      console.error('[GameScreen] 保存进度失败:', error);
    }
  }

  /** 脚本结束 */
  private onScriptEnd(): void {
    console.log('[GameScreen] 脚本播放完毕');
    this.exitGame();
  }

  private getLastPlayableLine(): number {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      if (this.commands[i]?.type !== 'end') {
        return i;
      }
    }
    return 0;
  }

  private isEndingCommand(cmd?: ScriptCommand): boolean {
    if (!cmd || cmd.type !== 'end') return false;
    const isGame = (cmd.params?.isGame as boolean | undefined) ?? false;
    return isGame;
  }

  /** 退出游戏 */
  private exitGame(): void {
    this.screenManager.pop();
  }

  /** 清理资源 */
  private cleanup(): void {
    this.inputController.reset();
    this.resourceManager.cleanup();
  }

  // === BaseScreen 接口 ===

  async show(params?: Record<string, unknown>): Promise<void> {
    console.log('[GameScreen] 显示', params);

    // 初始化游戏状态
    if (params) {
      const worldId = (params.worldId as string) || '';
      const chapter = (params.chapter as string) || 'chapter1';
      const line = (params.line as number) || 0;
      const fromSave = params.fromSave as boolean;
      
      if (fromSave && params.saveData) {
        // 从存档恢复
        this.gameState = fromSaveData(params.saveData as Record<string, unknown>);
        console.log('[GameScreen] 从存档恢复:', this.gameState.currentChapter);
      } else {
        // 新游戏
        this.gameState = createInitialState(worldId, chapter, line);
      }
    } else {
      this.gameState = createInitialState('', 'chapter1', 0);
    }

    this.container.setVisible(true);
    this.container.setAlpha(0);
    
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 300,
    });

    // 加载世界和脚本
    const loaded = await this.loadWorldAndScript();
    if (!loaded) {
      this.exitGame();
      return;
    }

    // 如果存档停在结局指令或超出范围，回退到可播放的最后一条
    if (this.gameState.currentLine >= this.commands.length) {
      this.gameState = {
        ...this.gameState,
        currentLine: this.getLastPlayableLine(),
      };
    } else if (this.isEndingCommand(this.commands[this.gameState.currentLine])) {
      this.gameState = {
        ...this.gameState,
        currentLine: Math.max(0, this.gameState.currentLine - 1),
      };
    }
    
    // 开始执行
    this.executeCurrentCommand();
  }

  hide(): void {
    console.log('[GameScreen] 隐藏');
    
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 300,
      onComplete: () => {
        this.container.setVisible(false);
        this.cleanup();
      },
    });
  }

  destroy(): void {
    this.cleanup();
    this.inputController.destroy();
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
