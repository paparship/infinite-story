/**
 * 标题画面
 * 显示游戏标题和主菜单按钮
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import { ScreenManager } from '../core/ScreenManager';
import { SettingsScreen } from './SettingsScreen';
import { WorldSelectionScreen } from './WorldSelectionScreen';
import { StoryTreeSelectScreen } from './StoryTreeSelectScreen';
import { StoryTreeViewScreen } from './StoryTreeViewScreen';
import { CGGallerySelectScreen } from './CGGallerySelectScreen';
import { CGGalleryViewScreen } from './CGGalleryViewScreen';
import { CharacterGallerySelectScreen } from './CharacterGallerySelectScreen';
import { CharacterGalleryViewScreen } from './CharacterGalleryViewScreen';
import { GameScreen } from './GameScreen';
import { WorldCreationScreen } from './WorldCreationScreen';
import { WorldGenerationScreen } from './WorldGenerationScreen';
import type { DataProvider } from '../data/DataProvider';
import { FileDataProvider } from '../data/FileDataProvider';

/** 菜单按钮配置 */
interface MenuButton {
  text: string;
  icon: string;
  action: string; // 动作标识
}

/** 菜单按钮列表 */
const MENU_BUTTONS: MenuButton[] = [
  { text: '选择世界', icon: '🌍', action: 'selectWorld' },
  { text: '剧情树', icon: '🌳', action: 'storyTree' },
  { text: 'CG回顾', icon: '🖼️', action: 'cgGallery' },
  { text: '角色鉴赏', icon: '🎴', action: 'characterGallery' },
  { text: '游戏设置', icon: '⚙', action: 'settings' },
];

export class TitleScreen extends Phaser.Scene implements BaseScreen {
  readonly name = 'title';
  container!: Phaser.GameObjects.Container;
  
  private screenManager!: ScreenManager;
  private dataProvider!: DataProvider;

  constructor() {
    super('TitleScreen');
  }

  create(): void {
    // 初始化界面管理器
    this.screenManager = new ScreenManager();
    
    // 初始化数据提供者（从文件系统读取）
    this.dataProvider = new FileDataProvider('/assets/worlds');
    console.log('[TitleScreen] 使用 FileDataProvider');
    
    // 创建主容器
    this.container = this.add.container(0, 0);
    
    this.createBackground();
    this.createTitle();
    this.createMenuButtons();
    this.createFooter();
    
    // 注册界面
    this.screenManager.register(this);
    this.screenManager.register(new SettingsScreen(this, this.screenManager));
    this.screenManager.register(new WorldSelectionScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new StoryTreeSelectScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new StoryTreeViewScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new CGGallerySelectScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new CGGalleryViewScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new CharacterGallerySelectScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new CharacterGalleryViewScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new GameScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new WorldCreationScreen(this, this.screenManager));
    this.screenManager.register(new WorldGenerationScreen(this, this.screenManager));
    
    // 设置初始界面
    this.screenManager.switchTo('title');
    
    console.log('[TitleScreen] 界面创建完成');
  }

  /** 创建渐变背景 */
  private createBackground(): void {
    const graphics = this.add.graphics();
    
    for (let i = 0; i < 720; i++) {
      const ratio = i / 720;
      const r = Math.floor(8 + ratio * 10);
      const g = Math.floor(10 + ratio * 15);
      const b = Math.floor(20 + ratio * 20);
      graphics.fillStyle(Phaser.Display.Color.GetColor(r, g, b), 1);
      graphics.fillRect(0, i, 1280, 1);
    }
    
    this.container.add(graphics);
  }

  /** 创建标题区域 */
  private createTitle(): void {
    const title = this.add.text(640, 140, '无限物语', {
      fontSize: '72px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5);
    this.container.add(title);

    const subtitle = this.add.text(640, 210, 'INFINITE STORY', {
      fontSize: '22px',
      fontFamily: 'Arial, sans-serif',
      color: '#8B9DC3',
      letterSpacing: 10,
    });
    subtitle.setOrigin(0.5);
    this.container.add(subtitle);

    const tagline = this.add.text(640, 255, 'AI 驱动 · 每次启动皆是全新世界', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#10B981',
    });
    tagline.setOrigin(0.5);
    this.container.add(tagline);

    this.tweens.add({
      targets: title,
      y: title.y - 6,
      duration: 2500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** 创建菜单按钮 */
  private createMenuButtons(): void {
    const startY = 320;
    const gap = 55;

    MENU_BUTTONS.forEach((btn, index) => {
      const y = startY + index * gap;
      this.createButton(btn.icon, btn.text, y, btn.action);
    });
  }

  /** 创建单个按钮 */
  private createButton(
    icon: string, 
    text: string, 
    y: number, 
    action: string
  ): Phaser.GameObjects.Container {
    const btnContainer = this.add.container(640, y);

    const bg = this.add.graphics();
    this.drawButtonBg(bg, false);
    btnContainer.add(bg);

    const iconText = this.add.text(-120, 0, icon, {
      fontSize: '22px',
      color: '#8aaaca',
    });
    iconText.setOrigin(0.5);
    btnContainer.add(iconText);

    const label = this.add.text(0, 0, text, {
      fontSize: '24px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    label.setOrigin(0.5);
    btnContainer.add(label);

    const arrow = this.add.text(120, 0, '›', {
      fontSize: '28px',
      color: '#FFD700',
    });
    arrow.setOrigin(0.5);
    arrow.setAlpha(0);
    btnContainer.add(arrow);

    const hitArea = this.add.rectangle(0, 0, 300, 48, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btnContainer.add(hitArea);

    hitArea.on('pointerover', () => {
      console.log(`[TitleScreen] 悬停: ${text}`);
      this.drawButtonBg(bg, true);
      label.setColor('#FFD700');
      iconText.setColor('#FFD700');
      arrow.setAlpha(1);
    });

    hitArea.on('pointerout', () => {
      this.drawButtonBg(bg, false);
      label.setColor('#FFFFFF');
      iconText.setColor('#8aaaca');
      arrow.setAlpha(0);
    });

    hitArea.on('pointerdown', () => {
      console.log(`[TitleScreen] 点击: ${text} (action: ${action})`);
      this.handleButtonClick(action);
    });

    this.container.add(btnContainer);
    return btnContainer;
  }

  /** 处理按钮点击 */
  private handleButtonClick(action: string): void {
    switch (action) {
      case 'selectWorld':
        this.screenManager.push('worldSelection');
        break;
      case 'storyTree':
        this.screenManager.push('storyTreeSelect');
        break;
      case 'cgGallery':
        this.screenManager.push('cgGallerySelect');
        break;
      case 'settings':
        this.screenManager.push('settings');
        break;
      case 'characterGallery':
        this.screenManager.push('characterGallerySelect');
        break;
      default:
        console.log(`[TitleScreen] 未知动作: ${action}`);
    }
  }

  /** 绘制按钮背景 */
  private drawButtonBg(graphics: Phaser.GameObjects.Graphics, hover: boolean): void {
    graphics.clear();
    
    if (hover) {
      graphics.fillStyle(0x3a4a6a, 0.9);
      graphics.fillRoundedRect(-150, -24, 300, 48, 10);
      graphics.lineStyle(2, 0xFFD700, 0.8);
      graphics.strokeRoundedRect(-150, -24, 300, 48, 10);
    } else {
      graphics.fillStyle(0x2a3a5a, 0.6);
      graphics.fillRoundedRect(-150, -24, 300, 48, 10);
      graphics.lineStyle(1, 0x5a7aaa, 0.4);
      graphics.strokeRoundedRect(-150, -24, 300, 48, 10);
    }
  }

  /** 创建底部信息 */
  private createFooter(): void {
    const hint = this.add.text(640, 680, '点击/空格 推进对话 | Ctrl 快速跳过 | ESC 菜单', {
      fontSize: '14px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#4a5a7a',
    });
    hint.setOrigin(0.5);
    this.container.add(hint);

    const version = this.add.text(1260, 705, 'V2.0.0-alpha', {
      fontSize: '12px',
      color: '#4a5a7a',
    });
    version.setOrigin(1, 1);
    this.container.add(version);
  }

  // BaseScreen 接口实现
  show(): void {
    console.log('[TitleScreen] 显示');
    this.container.setVisible(true);
  }

  hide(): void {
    console.log('[TitleScreen] 隐藏');
    this.container.setVisible(false);
  }

  destroy(): void {
    console.log('[TitleScreen] 销毁');
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
