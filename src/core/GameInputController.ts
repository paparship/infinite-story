/**
 * 游戏输入控制器
 * 负责键鼠输入与 Ctrl 快进逻辑
 */

import Phaser from 'phaser';

export interface GameInputControllerOptions {
  isActive: () => boolean;
  isChoiceVisible: () => boolean;
  isCgLocked: () => boolean;
  isTyping: () => boolean;
  completeTyping: () => void;
  isWaitingForInput: () => boolean;
  isAnimating: () => boolean;
  advanceLine: () => void;
  executeCurrentCommand: () => void;
  exitGame: () => void;
}

export class GameInputController {
  private scene: Phaser.Scene;
  private options: GameInputControllerOptions;
  private isCtrlHeld = false;
  private ctrlSkipTimer: Phaser.Time.TimerEvent | null = null;
  private readonly ctrlSkipDelay: number;

  private pointerHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private spaceHandler: (() => void) | null = null;
  private escHandler: (() => void) | null = null;
  private ctrlDownHandler: (() => void) | null = null;
  private ctrlUpHandler: (() => void) | null = null;

  constructor(scene: Phaser.Scene, options: GameInputControllerOptions, ctrlSkipDelay: number = 50) {
    this.scene = scene;
    this.options = options;
    this.ctrlSkipDelay = ctrlSkipDelay;
    this.bindInput();
  }

  reset(): void {
    this.stopCtrlSkip();
    this.isCtrlHeld = false;
  }

  destroy(): void {
    this.reset();
    if (this.pointerHandler) {
      this.scene.input.off('pointerdown', this.pointerHandler);
      this.pointerHandler = null;
    }
    if (this.spaceHandler) {
      this.scene.input.keyboard?.off('keydown-SPACE', this.spaceHandler);
      this.spaceHandler = null;
    }
    if (this.escHandler) {
      this.scene.input.keyboard?.off('keydown-ESC', this.escHandler);
      this.escHandler = null;
    }
    if (this.ctrlDownHandler) {
      this.scene.input.keyboard?.off('keydown-CTRL', this.ctrlDownHandler);
      this.ctrlDownHandler = null;
    }
    if (this.ctrlUpHandler) {
      this.scene.input.keyboard?.off('keyup-CTRL', this.ctrlUpHandler);
      this.ctrlUpHandler = null;
    }
  }

  private bindInput(): void {
    this.pointerHandler = () => {
      if (!this.options.isActive()) return;
      if (this.options.isChoiceVisible()) return;
      this.advanceDialogue();
    };
    this.scene.input.on('pointerdown', this.pointerHandler);

    this.spaceHandler = () => {
      if (!this.options.isActive()) return;
      if (this.options.isChoiceVisible()) return;
      this.advanceDialogue();
    };
    this.scene.input.keyboard?.on('keydown-SPACE', this.spaceHandler);

    this.escHandler = () => {
      if (!this.options.isActive()) return;
      console.log('[GameInputController] ESC 返回');
      this.options.exitGame();
    };
    this.scene.input.keyboard?.on('keydown-ESC', this.escHandler);

    this.ctrlDownHandler = () => {
      if (!this.options.isActive()) return;
      if (this.isCtrlHeld) return;
      this.isCtrlHeld = true;
      console.log('[GameInputController] Ctrl 加速开始');
      this.startCtrlSkip();
    };
    this.scene.input.keyboard?.on('keydown-CTRL', this.ctrlDownHandler);

    this.ctrlUpHandler = () => {
      this.isCtrlHeld = false;
      this.stopCtrlSkip();
      console.log('[GameInputController] Ctrl 加速停止');
    };
    this.scene.input.keyboard?.on('keyup-CTRL', this.ctrlUpHandler);
  }

  private advanceDialogue(): void {
    if (this.options.isCgLocked()) {
      return;
    }
    if (this.options.isTyping()) {
      this.options.completeTyping();
      return;
    }
    if (this.options.isWaitingForInput() && !this.options.isAnimating()) {
      this.options.advanceLine();
      this.options.executeCurrentCommand();
    }
  }

  private startCtrlSkip(): void {
    this.stopCtrlSkip();

    // 立即执行一次快进
    this.ctrlSkipOnce();

    this.ctrlSkipTimer = this.scene.time.addEvent({
      delay: this.ctrlSkipDelay,
      callback: this.ctrlSkipOnce,
      callbackScope: this,
      loop: true,
    });
  }

  private stopCtrlSkip(): void {
    if (this.ctrlSkipTimer) {
      this.ctrlSkipTimer.destroy();
      this.ctrlSkipTimer = null;
    }
  }

  private ctrlSkipOnce(): void {
    if (!this.isCtrlHeld) {
      this.stopCtrlSkip();
      return;
    }

    if (this.options.isChoiceVisible()) {
      this.stopCtrlSkip();
      console.log('[GameInputController] Ctrl 快进：遇到选项，停止');
      return;
    }

    if (this.options.isCgLocked()) {
      return;
    }

    if (this.options.isTyping()) {
      this.options.completeTyping();
      return;
    }

    if (this.options.isWaitingForInput() && !this.options.isAnimating()) {
      this.options.advanceLine();
      this.options.executeCurrentCommand();
    }
  }
}
