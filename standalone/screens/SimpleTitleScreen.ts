/**
 * 简化版标题画面
 * 用于独立版游戏，移除多世界和AI生成相关概念
 */

import Phaser from 'phaser';
import type { BaseScreen } from '../../src/screens/BaseScreen';
import { ScreenManager } from '../../src/core/ScreenManager';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { GameScreen } from '../../src/screens/GameScreen';
import { StoryTreeViewScreen } from '../../src/screens/StoryTreeViewScreen';
import { CGGalleryViewScreen } from '../../src/screens/CGGalleryViewScreen';
import { CharacterGalleryViewScreen } from '../../src/screens/CharacterGalleryViewScreen';
import { SingleWorldProvider } from '../data/SingleWorldProvider';
import { GAME_CONFIG } from '../config';

/** 菜单按钮配置 */
interface MenuButton {
  text: string;
  icon: string;
  action: string;
  requiresSave?: boolean; // 是否需要存档才显示
}

/** 菜单按钮列表（动态生成） */
function getMenuButtons(hasSave: boolean): MenuButton[] {
  const buttons: MenuButton[] = [];
  
  if (hasSave) {
    buttons.push({ text: '继续游戏', icon: '📖', action: 'continue' });
  }
  buttons.push({ text: '开始游戏', icon: '▶️', action: 'start' });
  buttons.push({ text: '剧情树', icon: '🌳', action: 'storyTree' });
  buttons.push({ text: 'CG回顾', icon: '🖼️', action: 'cgGallery' });
  buttons.push({ text: '角色鉴赏', icon: '🎴', action: 'characterGallery' });
  buttons.push({ text: '游戏设置', icon: '⚙️', action: 'settings' });
  
  return buttons;
}

export class SimpleTitleScreen extends Phaser.Scene implements BaseScreen {
  readonly name = 'title';
  container!: Phaser.GameObjects.Container;
  
  private screenManager!: ScreenManager;
  private dataProvider!: SingleWorldProvider;
  
  // 动态数据
  private gameTitle: string = '视觉小说';
  private gameDescription: string = '';
  private worldId: string = '';
  private menuContainer!: Phaser.GameObjects.Container;

  constructor() {
    super('SimpleTitleScreen');
  }

  async create(): Promise<void> {
    // 初始化界面管理器
    this.screenManager = new ScreenManager();
    
    // 初始化数据提供者
    this.dataProvider = new SingleWorldProvider();
    console.log('[SimpleTitleScreen] 使用 SingleWorldProvider');
    
    // 获取世界 ID
    this.worldId = this.dataProvider.getWorldId();
    
    // 创建主容器
    this.container = this.add.container(0, 0);
    
    this.createBackground();
    
    // 加载世界配置获取标题
    await this.loadGameInfo();
    
    this.createTitle();
    this.createMenuButtons();
    this.createFooter();
    
    // 注册界面
    this.screenManager.register(this);
    this.screenManager.register(new SettingsScreen(this, this.screenManager));
    this.screenManager.register(new GameScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new StoryTreeViewScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new CGGalleryViewScreen(this, this.screenManager, this.dataProvider));
    this.screenManager.register(new CharacterGalleryViewScreen(this, this.screenManager, this.dataProvider));
    
    // 设置初始界面
    this.screenManager.switchTo('title');
    
    console.log('[SimpleTitleScreen] 界面创建完成');
  }

  /** 加载游戏信息 */
  private async loadGameInfo(): Promise<void> {
    try {
      const config = await this.dataProvider.loadWorldConfig();
      if (config) {
        this.gameTitle = config.game.title || '视觉小说';
        this.gameDescription = config.game.description || '';
        console.log('[SimpleTitleScreen] 游戏标题:', this.gameTitle);
      }
    } catch (error) {
      console.error('[SimpleTitleScreen] 加载游戏信息失败:', error);
    }
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
    // 游戏标题（从 world.json 读取）
    const title = this.add.text(640, 140, this.gameTitle, {
      fontSize: '64px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5);
    this.container.add(title);

    // 游戏描述（如果有）
    if (this.gameDescription) {
      const description = this.add.text(640, 210, this.gameDescription, {
        fontSize: '18px',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        color: '#8aaaca',
        wordWrap: { width: 800 },
        align: 'center',
      });
      description.setOrigin(0.5);
      this.container.add(description);
    }

    // 标题呼吸动画
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
    this.menuContainer = this.add.container(0, 0);
    this.container.add(this.menuContainer);
    
    this.rebuildMenu();
  }

  /** 重建菜单（根据存档状态） */
  private rebuildMenu(): void {
    this.menuContainer.removeAll(true);
    
    const hasSave = this.dataProvider.hasSave();
    const buttons = getMenuButtons(hasSave);
    
    const startY = this.gameDescription ? 290 : 270;
    const gap = 55;

    buttons.forEach((btn, index) => {
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
      console.log(`[SimpleTitleScreen] 点击: ${text} (action: ${action})`);
      this.handleButtonClick(action);
    });

    this.menuContainer.add(btnContainer);
    return btnContainer;
  }

  /** 处理按钮点击 */
  private async handleButtonClick(action: string): Promise<void> {
    switch (action) {
      case 'start':
        // 开始新游戏
        this.screenManager.push('game', {
          worldId: this.worldId,
          chapter: 'chapter1',
          line: 0,
          fromSave: false,
        });
        break;
        
      case 'continue':
        // 继续游戏（加载存档）
        const saveData = await this.dataProvider.getSaveData(this.worldId);
        if (saveData) {
          this.screenManager.push('game', {
            worldId: this.worldId,
            chapter: saveData.currentChapter,
            line: saveData.currentLine,
            fromSave: true,
          });
        } else {
          // 如果存档丢失，从头开始
          this.handleButtonClick('start');
        }
        break;
        
      case 'storyTree':
        this.screenManager.push('storyTreeView', {
          worldId: this.worldId,
          worldTitle: this.gameTitle,
        });
        break;
        
      case 'cgGallery':
        this.screenManager.push('cgGalleryView', {
          worldId: this.worldId,
          worldTitle: this.gameTitle,
        });
        break;
        
      case 'characterGallery':
        this.screenManager.push('characterGalleryView', {
          worldId: this.worldId,
          worldTitle: this.gameTitle,
        });
        break;
        
      case 'settings':
        this.screenManager.push('settings');
        break;
        
      default:
        console.log(`[SimpleTitleScreen] 未知动作: ${action}`);
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

    const version = this.add.text(1260, 705, `v${GAME_CONFIG.version}`, {
      fontSize: '12px',
      color: '#4a5a7a',
    });
    version.setOrigin(1, 1);
    this.container.add(version);
  }

  // BaseScreen 接口实现
  show(): void {
    console.log('[SimpleTitleScreen] 显示');
    this.container.setVisible(true);
    // 重建菜单以反映存档状态变化
    this.rebuildMenu();
  }

  hide(): void {
    console.log('[SimpleTitleScreen] 隐藏');
    this.container.setVisible(false);
  }

  destroy(): void {
    console.log('[SimpleTitleScreen] 销毁');
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
