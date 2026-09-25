/**
 * 选项面板组件
 * 显示选项按钮，处理用户选择
 */

import Phaser from 'phaser';
import type { ChoiceOption } from '../core/ScriptParser';

/** 选项配置 */
const CHOICE_CONFIG = {
  centerX: 640,
  centerY: 360,
  spacing: 18,
  buttonWidth: 700,
  buttonHeight: 76,
  buttonHeightWithHint: 92,
  textHorizontalPadding: 40,
};

export class ChoicePanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private onSelect: (index: number) => void;
  
  // 选项按钮
  private buttons: Phaser.GameObjects.Container[] = [];
  private _isVisible: boolean = false;

  constructor(
    scene: Phaser.Scene,
    parentContainer: Phaser.GameObjects.Container,
    onSelect: (index: number) => void
  ) {
    this.scene = scene;
    this.onSelect = onSelect;
    this.container = this.scene.add.container(0, 0);
    this.container.setVisible(false);
    parentContainer.add(this.container);
  }

  /** 显示选项 */
  showChoices(options: ChoiceOption[]): void {
    this.clearButtons();
    
    const { centerX, centerY, spacing, buttonWidth, buttonHeight, buttonHeightWithHint } = CHOICE_CONFIG;

    // 根据是否有 hint 调整按钮高度，并整体垂直居中。
    const heights = options.map(option => (option.hint ? buttonHeightWithHint : buttonHeight));
    const totalHeight = heights.reduce((sum, h) => sum + h, 0) + spacing * Math.max(0, options.length - 1);
    let currentTopY = centerY - totalHeight / 2;

    options.forEach((option, index) => {
      const h = heights[index];
      const y = currentTopY + h / 2;
      const btn = this.createChoiceButton(option, centerX, y, buttonWidth, h);
      this.buttons.push(btn);
      this.container.add(btn);
      currentTopY += h + spacing;
    });

    this.container.setVisible(true);
    this._isVisible = true;

    // 淡入动画
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 200,
    });
  }

  /** 创建选项按钮 */
  private createChoiceButton(
    option: ChoiceOption,
    x: number,
    y: number,
    w: number,
    h: number
  ): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);
    const textWrapWidth = w - CHOICE_CONFIG.textHorizontalPadding * 2;

    // 背景
    const bg = this.scene.add.graphics();
    this.drawButtonBg(bg, w, h, false);
    btn.add(bg);

    // 文本
    const text = this.scene.add.text(0, 0, option.text, {
      fontSize: '22px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      align: 'center',
      wordWrap: { width: textWrapWidth, useAdvancedWrap: true },
    });
    text.setLineSpacing(2);
    this.fitMainChoiceText(text, option.text, option.hint ? 44 : 56);
    text.y = option.hint ? -10 : 0;
    text.setOrigin(0.5);
    btn.add(text);

    // 提示文本（如果有）
    if (option.hint) {
      const hintText = this.scene.add.text(0, 24, `（${option.hint}）`, {
        fontSize: '13px',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        color: '#8aaaca',
        align: 'center',
        wordWrap: { width: textWrapWidth, useAdvancedWrap: true },
      });
      this.fitHintText(hintText, `（${option.hint}）`, 24);
      hintText.setOrigin(0.5);
      btn.add(hintText);
    }

    // 交互区域
    const hitArea = this.scene.add.rectangle(0, 0, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    // 事件
    hitArea.on('pointerover', () => {
      this.drawButtonBg(bg, w, h, true);
      text.setColor('#FFD700');
    });

    hitArea.on('pointerout', () => {
      this.drawButtonBg(bg, w, h, false);
      text.setColor('#FFFFFF');
    });

    hitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      console.log(`[ChoicePanel] 选择: ${option.index} - ${option.text.substring(0, 20)}... (点击位置: ${Math.round(pointer.x)}, ${Math.round(pointer.y)})`);
      console.log(`[ChoicePanel] 按钮位置: (${x}, ${y}), 尺寸: ${w}x${h}`);
      this.onSelect(option.index);
    });

    return btn;
  }

  /** 主选项文案自适应：先降字号，再截断到可显示高度 */
  private fitMainChoiceText(
    textObj: Phaser.GameObjects.Text,
    rawText: string,
    maxHeight: number
  ): void {
    const fontSizes = [22, 21, 20, 19, 18, 17, 16];
    for (const size of fontSizes) {
      textObj.setFontSize(size);
      textObj.setText(rawText);
      if (textObj.height <= maxHeight) {
        return;
      }
    }
    this.truncateTextToHeight(textObj, rawText, maxHeight);
  }

  /** hint 文案自适应，避免把按钮撑爆 */
  private fitHintText(
    textObj: Phaser.GameObjects.Text,
    rawText: string,
    maxHeight: number
  ): void {
    textObj.setText(rawText);
    if (textObj.height <= maxHeight) {
      return;
    }
    textObj.setFontSize(12);
    textObj.setText(rawText);
    if (textObj.height <= maxHeight) {
      return;
    }
    this.truncateTextToHeight(textObj, rawText, maxHeight);
  }

  /** 按高度截断文本，末尾补省略号 */
  private truncateTextToHeight(
    textObj: Phaser.GameObjects.Text,
    rawText: string,
    maxHeight: number
  ): void {
    const source = rawText.trim();
    if (!source) {
      textObj.setText('');
      return;
    }

    for (let i = source.length - 1; i > 0; i--) {
      const candidate = `${source.slice(0, i).trimEnd()}...`;
      textObj.setText(candidate);
      if (textObj.height <= maxHeight) {
        return;
      }
    }

    textObj.setText('...');
  }

  /** 绘制按钮背景 */
  private drawButtonBg(
    graphics: Phaser.GameObjects.Graphics,
    w: number,
    h: number,
    hover: boolean
  ): void {
    graphics.clear();

    if (hover) {
      graphics.fillStyle(0x3a4a6a, 0.95);
      graphics.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      graphics.lineStyle(2, 0xFFD700, 0.9);
      graphics.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    } else {
      graphics.fillStyle(0x1a2a3a, 0.9);
      graphics.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      graphics.lineStyle(2, 0x4a6a9a, 0.7);
      graphics.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    }
  }

  /** 清除所有按钮 */
  private clearButtons(): void {
    this.buttons.forEach(btn => btn.destroy());
    this.buttons = [];
  }

  /** 隐藏选项面板 */
  hide(): void {
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        this.container.setVisible(false);
        this.clearButtons();
        this._isVisible = false;
      },
    });
  }

  /** 是否可见 */
  isVisible(): boolean {
    return this._isVisible;
  }

  /** 销毁 */
  destroy(): void {
    this.clearButtons();
    this.container.destroy();
  }
}
