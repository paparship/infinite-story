/**
 * 对话框组件
 * 显示角色对话和旁白，支持打字机效果
 */

import Phaser from 'phaser';

/** 打字机速度（毫秒/字符） */
const TYPING_SPEED = 30;

/** 对话框配置 */
const BOX_CONFIG = {
  x: 640,
  y: 620,
  width: 1200,
  height: 160,
  padding: 20,
  nameOffsetY: -90,  // 名称在对话框上方
  textOffsetY: -45,  // 文本起始位置
};

export class DialogueBox {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;

  // UI 元素
  private boxBg!: Phaser.GameObjects.Graphics;
  private nameText!: Phaser.GameObjects.Text;
  private dialogueText!: Phaser.GameObjects.Text;
  private indicator!: Phaser.GameObjects.Text;

  // 打字机状态
  private fullText: string = '';
  private currentIndex: number = 0;
  private typingTimer: Phaser.Time.TimerEvent | null = null;
  private _isTyping: boolean = false;

  constructor(scene: Phaser.Scene, parentContainer: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.container = this.scene.add.container(BOX_CONFIG.x, BOX_CONFIG.y);
    this.container.setVisible(false);
    parentContainer.add(this.container);

    this.createUI();
  }

  /** 创建 UI */
  private createUI(): void {
    const { width, height, padding, nameOffsetY } = BOX_CONFIG;

    // 对话框背景
    this.boxBg = this.scene.add.graphics();
    this.drawBoxBg();
    this.container.add(this.boxBg);

    // 角色名称
    this.nameText = this.scene.add.text(-width / 2 + padding, nameOffsetY, '', {
      fontSize: '24px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFB7C5',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.container.add(this.nameText);

    // 对话文本
    this.dialogueText = this.scene.add.text(
      -width / 2 + padding,
      BOX_CONFIG.textOffsetY,
      '',
      {
        fontSize: '22px',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        color: '#FFFFFF',
        wordWrap: { width: width - padding * 2, useAdvancedWrap: true },
        lineSpacing: 8,
        maxLines: 4,
      }
    );
    this.dialogueText.setOrigin(0, 0);
    this.container.add(this.dialogueText);

    // 继续指示器
    this.indicator = this.scene.add.text(width / 2 - padding - 20, height / 2 - padding - 10, '▼', {
      fontSize: '18px',
      color: '#FFFFFF',
    });
    this.indicator.setOrigin(0.5);
    this.indicator.setAlpha(0);
    this.container.add(this.indicator);

    // 指示器闪烁动画
    this.scene.tweens.add({
      targets: this.indicator,
      alpha: { from: 0.3, to: 1 },
      duration: 500,
      yoyo: true,
      repeat: -1,
    });
  }

  /** 绘制对话框背景 */
  private drawBoxBg(): void {
    const { width, height } = BOX_CONFIG;
    
    this.boxBg.clear();
    
    // 半透明黑色背景
    this.boxBg.fillStyle(0x000000, 0.75);
    this.boxBg.fillRoundedRect(-width / 2, -height / 2, width, height, 15);
    
    // 边框
    this.boxBg.lineStyle(2, 0x4a6a9a, 0.8);
    this.boxBg.strokeRoundedRect(-width / 2, -height / 2, width, height, 15);
  }

  /** 设置对话 */
  setDialogue(name: string, text: string, nameColor: string = '#FFB7C5'): void {
    this.nameText.setText(name);
    this.nameText.setColor(nameColor);
    this.nameText.setVisible(true);
    
    this.startTyping(text);
  }

  /** 设置旁白 */
  setNarration(text: string): void {
    this.nameText.setVisible(false);
    this.startTyping(text);
  }

  /** 开始打字机效果 */
  private startTyping(text: string): void {
    this.stopTyping();
    
    this.fullText = text;
    this.currentIndex = 0;
    this._isTyping = true;
    this.indicator.setAlpha(0);
    
    this.dialogueText.setText('');
    
    this.typingTimer = this.scene.time.addEvent({
      delay: TYPING_SPEED,
      callback: this.typeNextChar,
      callbackScope: this,
      loop: true,
    });
  }

  /** 打印下一个字符 */
  private typeNextChar(): void {
    if (this.currentIndex >= this.fullText.length) {
      this.completeTyping();
      return;
    }

    this.currentIndex++;
    this.dialogueText.setText(this.fullText.substring(0, this.currentIndex));
  }

  /** 停止打字机 */
  private stopTyping(): void {
    if (this.typingTimer) {
      this.typingTimer.destroy();
      this.typingTimer = null;
    }
    this._isTyping = false;
  }

  /** 完成打字机效果（快速显示全部文本） */
  completeTyping(): void {
    this.stopTyping();
    this.dialogueText.setText(this.fullText);
    this.indicator.setAlpha(1);
  }

  /** 是否正在打字 */
  isTyping(): boolean {
    return this._isTyping;
  }

  /** 显示对话框 */
  show(): void {
    this.container.setVisible(true);
  }

  /** 隐藏对话框 */
  hide(): void {
    this.stopTyping();
    this.container.setVisible(false);
  }

  /** 销毁 */
  destroy(): void {
    this.stopTyping();
    this.container.destroy();
  }
}
