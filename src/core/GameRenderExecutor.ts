/**
 * 渲染执行器
 * 负责背景、角色、对话、CG、特效等渲染相关逻辑
 */

import Phaser from 'phaser';
import type { ChoiceOption } from './ScriptParser';
import type { GameState } from './GameState';
import type { WorldConfig } from '../types';
import { getBackgroundPath } from './BackgroundMap';
import { unlockCG } from './GameState';
import type { DialogueBox } from '../ui/DialogueBox';
import type { CharacterDisplay } from '../ui/CharacterDisplay';
import type { ChoicePanel } from '../ui/ChoicePanel';
import type { EffectManager, EffectType } from '../ui/EffectManager';

export interface GameRenderExecutorOptions {
  scene: Phaser.Scene;
  container: Phaser.GameObjects.Container;
  bgLayer: Phaser.GameObjects.Container;
  charLayer: Phaser.GameObjects.Container;
  cgLayer: Phaser.GameObjects.Container;
  effectManager: EffectManager;
  dialogueBox: DialogueBox;
  characterDisplay: CharacterDisplay;
  choicePanel: ChoicePanel;
  getWorldConfig: () => WorldConfig | null;
  getWorldBasePath: () => string | null;
  getGameState: () => GameState;
  setGameState: (state: GameState) => void;
  getCurrentBg: () => Phaser.GameObjects.Image | null;
  setCurrentBg: (bg: Phaser.GameObjects.Image | null) => void;
  getCurrentCG: () => Phaser.GameObjects.Image | null;
  setCurrentCG: (cg: Phaser.GameObjects.Image | null) => void;
  getCurrentCGTitle: () => Phaser.GameObjects.Text | null;
  setCurrentCGTitle: (title: Phaser.GameObjects.Text | null) => void;
  getLastCharacterName: () => string;
  setLastCharacterName: (name: string) => void;
  addLoadedTexture: (key: string) => void;
  setCgLockUntil: (value: number) => void;
  setWaitingForInput: (value: boolean) => void;
  setCurrentChoiceCount: (value: number) => void;
  setIsCurrentChoiceRouteBranch: (value: boolean) => void;
  advanceLine: () => void;
  executeCurrentCommand: () => void;
  titleDepth: number;
}

export class GameRenderExecutor {
  private options: GameRenderExecutorOptions;

  constructor(options: GameRenderExecutorOptions) {
    this.options = options;
  }

  executeBackground(bgId: string): void {
    this.options.characterDisplay.hideAll();

    const bgPath = getBackgroundPath(bgId);
    const textureKey = `bg_${bgId}`;

    const showBg = () => {
      const currentBg = this.options.getCurrentBg();
      if (currentBg) {
        currentBg.destroy();
      }

      const bg = this.options.scene.add.image(640, 360, textureKey);
      bg.setDisplaySize(1280, 720);
      this.options.bgLayer.add(bg);
      this.options.setCurrentBg(bg);

      this.options.advanceLine();
      this.options.executeCurrentCommand();
    };

    if (this.options.scene.textures.exists(textureKey)) {
      showBg();
    } else {
      this.options.scene.load.image(textureKey, bgPath);
      this.options.scene.load.once('complete', showBg);
      this.options.scene.load.once('loaderror', () => {
        console.warn(`[GameRenderExecutor] 背景加载失败: ${bgPath}`);
        this.options.advanceLine();
        this.options.executeCurrentCommand();
      });
      this.options.scene.load.start();
    }
  }

  executeCharacter(params: Record<string, unknown>): void {
    const name = params.name as string;
    const expression = params.expression as string;
    const validPositions = ['left', 'center', 'right'];
    const rawPosition = params.position as string;
    const position = validPositions.includes(rawPosition) ? rawPosition as 'left' | 'center' | 'right' : 'center';

    this.options.characterDisplay.showCharacter(name, expression, position);
    this.options.setLastCharacterName(name);

    this.options.advanceLine();
    this.options.executeCurrentCommand();
  }

  executeHideCharacter(name: string): void {
    this.options.characterDisplay.hideCharacter(name);
    this.options.advanceLine();
    this.options.executeCurrentCommand();
  }

  executeDialogue(name: string, text: string): void {
    this.hideCG();

    let color = '#FFFFFF';
    const worldConfig = this.options.getWorldConfig();
    if (worldConfig) {
      const char = worldConfig.game.characters.find(c => c.name === name);
      if (char) {
        color = char.color;
      }
    }

    this.options.dialogueBox.show();
    this.options.dialogueBox.setDialogue(name, text, color);
    this.options.setWaitingForInput(true);
  }

  executeNarration(text: string): void {
    this.hideCG();

    this.options.dialogueBox.show();
    this.options.dialogueBox.setNarration(text);
    this.options.setWaitingForInput(true);
  }

  executeChoice(options: ChoiceOption[], isRouteBranch?: boolean): void {
    this.options.dialogueBox.hide();
    this.options.setCurrentChoiceCount(options.length);
    this.options.setIsCurrentChoiceRouteBranch(isRouteBranch || false);
    console.log(`[GameRenderExecutor] 显示选项: ${options.length} 个, 路线分支: ${isRouteBranch || false}`);
    this.options.choicePanel.showChoices(options);
  }

  executeCG(cgId: string, title: string): void {
    const state = this.options.getGameState();
    this.options.setGameState(unlockCG(state, cgId));

    this.options.dialogueBox.hide();

    const cgDir = cgId.replace(/^cg_/, '');
    const basePath = this.options.getWorldBasePath() || `/assets/worlds/${state.worldId}`;
    const cgPath = `${basePath}/cg/${cgDir}/${cgId}.png`;
    const textureKey = `cg_${state.worldId}_${cgId}`;

    const showCG = () => {
      this.hideCG();

      const cg = this.options.scene.add.image(640, 360, textureKey);
      const scaleX = 1280 / cg.width;
      const scaleY = 720 / cg.height;
      const scale = Math.max(scaleX, scaleY);
      cg.setScale(scale);
      cg.setAlpha(0);

      this.options.cgLayer.add(cg);
      this.options.setCurrentCG(cg);

      const titleText = this.options.getLastCharacterName()
        ? `${title}（${this.options.getLastCharacterName()}）`
        : title;
      if (titleText) {
        const titleNode = this.options.scene.add.text(640, 680, titleText, {
          fontFamily: 'serif',
          fontSize: '20px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
          shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 4, fill: true },
        });
        titleNode.setOrigin(0.5, 0.5);
        titleNode.setAlpha(0);
        this.options.cgLayer.add(titleNode);
        this.options.setCurrentCGTitle(titleNode);
      }

      this.options.scene.tweens.add({
        targets: [cg, this.options.getCurrentCGTitle()].filter(Boolean),
        alpha: 1,
        duration: 500,
        onComplete: () => {
          this.options.setCgLockUntil(Date.now() + 1000);
          this.options.setWaitingForInput(true);
        },
      });
    };

    if (this.options.scene.textures.exists(textureKey)) {
      showCG();
    } else {
      this.options.addLoadedTexture(textureKey);
      this.options.scene.load.image(textureKey, cgPath);
      this.options.scene.load.once('complete', showCG);
      this.options.scene.load.once('loaderror', () => {
        console.warn(`[GameRenderExecutor] CG 加载失败: ${cgPath}`);
        this.options.advanceLine();
        this.options.executeCurrentCommand();
      });
      this.options.scene.load.start();
    }
  }

  hideCG(): void {
    const currentCG = this.options.getCurrentCG();
    if (currentCG) {
      const targets = [currentCG, this.options.getCurrentCGTitle()].filter(Boolean);
      this.options.scene.tweens.add({
        targets,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          this.options.getCurrentCG()?.destroy();
          this.options.setCurrentCG(null);
          this.options.getCurrentCGTitle()?.destroy();
          this.options.setCurrentCGTitle(null);
        },
      });
    }
  }

  executeShake(): void {
    this.options.scene.cameras.main.shake(200, 0.01);
    this.options.advanceLine();
    this.options.executeCurrentCommand();
  }

  executeEffect(effectType: string): void {
    console.log(`[GameRenderExecutor] 特效: ${effectType}`);
    this.options.effectManager.playEffect(effectType as EffectType);
    this.options.advanceLine();
    this.options.executeCurrentCommand();
  }

  executeClear(): void {
    console.log(`[GameRenderExecutor] @clear: 清除所有角色和特效`);
    // 清除所有角色
    this.options.scene.children.list
      .filter((child: any) => child.name?.startsWith?.('character_'))
      .forEach((child: any) => child.destroy?.());
    // 停止所有特效
    this.options.effectManager.stopAll();
    this.options.advanceLine();
    this.options.executeCurrentCommand();
  }

  executeTitle(title: string): void {
    const titleText = this.options.scene.add.text(640, 360, title, {
      fontSize: '48px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      stroke: '#000000',
      strokeThickness: 4,
    });
    titleText.setOrigin(0.5);
    titleText.setAlpha(0);
    titleText.setDepth(this.options.titleDepth);
    this.options.container.add(titleText);

    this.options.scene.tweens.add({
      targets: titleText,
      alpha: 1,
      duration: 500,
      hold: 1500,
      yoyo: true,
      onComplete: () => {
        titleText.destroy();
        this.options.advanceLine();
        this.options.executeCurrentCommand();
      },
    });
  }
}
