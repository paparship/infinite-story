/**
 * 资源管理器
 * 负责纹理与临时渲染对象的生命周期清理
 */

import Phaser from 'phaser';
import type { DialogueBox } from '../ui/DialogueBox';
import type { ChoicePanel } from '../ui/ChoicePanel';
import type { CharacterDisplay } from '../ui/CharacterDisplay';
import type { EffectManager } from '../ui/EffectManager';

export interface GameResourceManagerOptions {
  scene: Phaser.Scene;
  dialogueBox: DialogueBox;
  choicePanel: ChoicePanel;
  characterDisplay: CharacterDisplay;
  effectManager: EffectManager;
  getLoadedTextures: () => string[];
  clearLoadedTextures: () => void;
  getCurrentBg: () => Phaser.GameObjects.Image | null;
  setCurrentBg: (bg: Phaser.GameObjects.Image | null) => void;
  getCurrentCG: () => Phaser.GameObjects.Image | null;
  setCurrentCG: (cg: Phaser.GameObjects.Image | null) => void;
  getCurrentCGTitle: () => Phaser.GameObjects.Text | null;
  setCurrentCGTitle: (title: Phaser.GameObjects.Text | null) => void;
}

export class GameResourceManager {
  private options: GameResourceManagerOptions;

  constructor(options: GameResourceManagerOptions) {
    this.options = options;
  }

  cleanup(): void {
    const textures = this.options.getLoadedTextures();
    textures.forEach(key => {
      if (this.options.scene.textures.exists(key)) {
        this.options.scene.textures.remove(key);
      }
    });
    this.options.clearLoadedTextures();

    this.options.dialogueBox.hide();
    this.options.choicePanel.hide();
    this.options.characterDisplay.hideAll();
    this.options.effectManager.stopAll();

    const bg = this.options.getCurrentBg();
    if (bg) {
      bg.destroy();
      this.options.setCurrentBg(null);
    }

    const cg = this.options.getCurrentCG();
    if (cg) {
      cg.destroy();
      this.options.setCurrentCG(null);
    }

    const cgTitle = this.options.getCurrentCGTitle();
    if (cgTitle) {
      cgTitle.destroy();
      this.options.setCurrentCGTitle(null);
    }
  }
}
