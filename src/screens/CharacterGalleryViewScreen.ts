/**
 * 角色鉴赏 - 角色展示界面
 * 展示角色立绘和表情差分，支持自动轮播
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';
import type { DataProvider } from '../data/DataProvider';
import type { CharacterInfo, Expression } from '../types';

/** 角色资源信息（运行时） */
interface CharacterAsset extends CharacterInfo {
  folder: string;
}

/** 表情配置 */
const EXPRESSIONS: { key: Expression; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'happy', label: '开心' },
  { key: 'angry', label: '生气' },
  { key: 'sad', label: '悲伤' },
  { key: 'joy', label: '大笑' },
];

/** 自动轮播间隔（毫秒） */
const AUTO_PLAY_INTERVAL = 2000;

export class CharacterGalleryViewScreen implements BaseScreen {
  readonly name = 'characterGalleryView';
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;
  private dataProvider: DataProvider;

  private worldId: string = '';
  private worldTitle: string = '';
  private baseUrl: string = '/assets/worlds';

  // 角色数据
  private characters: CharacterAsset[] = [];
  private currentCharIndex: number = 0;
  private currentExpression: Expression = 'default';

  // UI 组件
  private characterListContainer!: Phaser.GameObjects.Container;
  private spriteContainer!: Phaser.GameObjects.Container;
  private currentSprite: Phaser.GameObjects.Image | null = null;
  private nameText!: Phaser.GameObjects.Text;
  private expressionButtons: Phaser.GameObjects.Container[] = [];
  private characterButtons: Phaser.GameObjects.Container[] = [];

  // 自动轮播
  private autoPlayEnabled: boolean = true;
  private autoPlayTimer: Phaser.Time.TimerEvent | null = null;
  private autoPlayToggle!: Phaser.GameObjects.Container;
  private autoPlayText!: Phaser.GameObjects.Text;

  // 加载的纹理列表（用于清理）
  private loadedTextures: string[] = [];

  constructor(scene: Phaser.Scene, screenManager: ScreenManager, dataProvider: DataProvider) {
    this.scene = scene;
    this.screenManager = screenManager;
    this.dataProvider = dataProvider;
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(100);
    this.container.setVisible(false);

    this.createStaticUI();
  }

  private createStaticUI(): void {
    // 背景
    const bg = this.scene.add.rectangle(640, 360, 1280, 720, 0x0a0a1e, 0.98);
    bg.setInteractive();
    this.container.add(bg);

    // 标题（动态更新）
    this.nameText = this.scene.add.text(640, 45, '角色鉴赏', {
      fontSize: '32px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFB7C5',
    });
    this.nameText.setOrigin(0.5);
    this.container.add(this.nameText);

    // 左侧角色列表区域
    this.characterListContainer = this.scene.add.container(100, 120);
    this.container.add(this.characterListContainer);

    // 中央立绘展示区域
    this.spriteContainer = this.scene.add.container(640, 350);
    this.container.add(this.spriteContainer);

    // 底部表情按钮区域
    this.createExpressionButtons();

    // 自动轮播开关
    this.createAutoPlayToggle();

    // 返回按钮
    this.createBackButton();
  }

  private createExpressionButtons(): void {
    const startX = 300;
    const y = 660;
    const gap = 120;

    EXPRESSIONS.forEach((expr, index) => {
      const x = startX + index * gap;
      const btn = this.createExpressionButton(x, y, expr.key, expr.label);
      this.expressionButtons.push(btn);
      this.container.add(btn);
    });
  }

  private createExpressionButton(x: number, y: number, key: Expression, label: string): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x2a3a5a, 0.9);
    bg.fillRoundedRect(-45, -18, 90, 36, 8);
    bg.lineStyle(1, 0x4a6a9a, 0.6);
    bg.strokeRoundedRect(-45, -18, 90, 36, 8);
    btn.add(bg);

    const text = this.scene.add.text(0, 0, label, {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0.5);
    btn.add(text);

    const hitArea = this.scene.add.rectangle(0, 0, 90, 36, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    // 存储引用以便更新样式
    btn.setData('bg', bg);
    btn.setData('text', text);
    btn.setData('key', key);

    hitArea.on('pointerover', () => {
      if (this.currentExpression !== key) {
        bg.clear();
        bg.fillStyle(0x3a4a6a, 0.95);
        bg.fillRoundedRect(-45, -18, 90, 36, 8);
        bg.lineStyle(2, 0xFFB7C5, 0.8);
        bg.strokeRoundedRect(-45, -18, 90, 36, 8);
      }
    });

    hitArea.on('pointerout', () => {
      if (this.currentExpression !== key) {
        bg.clear();
        bg.fillStyle(0x2a3a5a, 0.9);
        bg.fillRoundedRect(-45, -18, 90, 36, 8);
        bg.lineStyle(1, 0x4a6a9a, 0.6);
        bg.strokeRoundedRect(-45, -18, 90, 36, 8);
      }
    });

    hitArea.on('pointerdown', () => {
      console.log(`[CharacterGalleryViewScreen] 切换表情: ${key}`);
      this.setExpression(key);
    });

    return btn;
  }

  private updateExpressionButtonStyles(): void {
    this.expressionButtons.forEach(btn => {
      const bg = btn.getData('bg') as Phaser.GameObjects.Graphics;
      const text = btn.getData('text') as Phaser.GameObjects.Text;
      const key = btn.getData('key') as Expression;
      const isActive = this.currentExpression === key;

      bg.clear();
      if (isActive) {
        bg.fillStyle(0xFFB7C5, 0.3);
        bg.fillRoundedRect(-45, -18, 90, 36, 8);
        bg.lineStyle(2, 0xFFB7C5, 1);
        bg.strokeRoundedRect(-45, -18, 90, 36, 8);
        text.setColor('#FFB7C5');
      } else {
        bg.fillStyle(0x2a3a5a, 0.9);
        bg.fillRoundedRect(-45, -18, 90, 36, 8);
        bg.lineStyle(1, 0x4a6a9a, 0.6);
        bg.strokeRoundedRect(-45, -18, 90, 36, 8);
        text.setColor('#FFFFFF');
      }
    });
  }

  private createAutoPlayToggle(): void {
    const x = 1100;
    const y = 660;

    this.autoPlayToggle = this.scene.add.container(x, y);

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x2a3a5a, 0.9);
    bg.fillRoundedRect(-60, -18, 120, 36, 8);
    bg.lineStyle(1, 0x4a6a9a, 0.6);
    bg.strokeRoundedRect(-60, -18, 120, 36, 8);
    this.autoPlayToggle.add(bg);

    this.autoPlayText = this.scene.add.text(0, 0, '🔄 自动: 关', {
      fontSize: '14px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    this.autoPlayText.setOrigin(0.5);
    this.autoPlayToggle.add(this.autoPlayText);

    const hitArea = this.scene.add.rectangle(0, 0, 120, 36, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    this.autoPlayToggle.add(hitArea);

    this.autoPlayToggle.setData('bg', bg);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x3a4a6a, 0.95);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
      bg.lineStyle(2, 0x90EE90, 0.8);
      bg.strokeRoundedRect(-60, -18, 120, 36, 8);
    });

    hitArea.on('pointerout', () => {
      this.updateAutoPlayStyle();
    });

    hitArea.on('pointerdown', () => {
      this.toggleAutoPlay();
    });

    this.container.add(this.autoPlayToggle);
  }

  private toggleAutoPlay(): void {
    this.autoPlayEnabled = !this.autoPlayEnabled;
    console.log(`[CharacterGalleryViewScreen] 自动轮播: ${this.autoPlayEnabled ? '开' : '关'}`);

    if (this.autoPlayEnabled) {
      this.startAutoPlay();
    } else {
      this.stopAutoPlay();
    }

    this.updateAutoPlayStyle();
  }

  private updateAutoPlayStyle(): void {
    const bg = this.autoPlayToggle.getData('bg') as Phaser.GameObjects.Graphics;
    bg.clear();

    if (this.autoPlayEnabled) {
      bg.fillStyle(0x90EE90, 0.3);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
      bg.lineStyle(2, 0x90EE90, 1);
      bg.strokeRoundedRect(-60, -18, 120, 36, 8);
      this.autoPlayText.setText('🔄 自动: 开');
      this.autoPlayText.setColor('#90EE90');
    } else {
      bg.fillStyle(0x2a3a5a, 0.9);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
      bg.lineStyle(1, 0x4a6a9a, 0.6);
      bg.strokeRoundedRect(-60, -18, 120, 36, 8);
      this.autoPlayText.setText('🔄 自动: 关');
      this.autoPlayText.setColor('#FFFFFF');
    }
  }

  private startAutoPlay(): void {
    this.stopAutoPlay();
    this.autoPlayTimer = this.scene.time.addEvent({
      delay: AUTO_PLAY_INTERVAL,
      callback: this.nextExpression,
      callbackScope: this,
      loop: true,
    });
  }

  private stopAutoPlay(): void {
    if (this.autoPlayTimer) {
      this.autoPlayTimer.destroy();
      this.autoPlayTimer = null;
    }
  }

  private nextExpression(): void {
    const currentIndex = EXPRESSIONS.findIndex(e => e.key === this.currentExpression);
    const nextIndex = (currentIndex + 1) % EXPRESSIONS.length;
    this.setExpression(EXPRESSIONS[nextIndex].key);
  }

  private createCharacterList(): void {
    this.characterListContainer.removeAll(true);
    this.characterButtons = [];

    const itemHeight = 80;
    const gap = 10;

    this.characters.forEach((char, index) => {
      const y = index * (itemHeight + gap);
      const btn = this.createCharacterButton(char, 0, y, index);
      this.characterButtons.push(btn);
      this.characterListContainer.add(btn);
    });
  }

  private createCharacterButton(char: CharacterAsset, x: number, y: number, index: number): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);
    const w = 160;
    const h = 80;

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x2a3a5a, 0.9);
    bg.fillRoundedRect(0, 0, w, h, 10);
    bg.lineStyle(1, 0x4a6a9a, 0.6);
    bg.strokeRoundedRect(0, 0, w, h, 10);
    btn.add(bg);

    // 角色主题色条
    const colorBar = this.scene.add.graphics();
    const color = Phaser.Display.Color.HexStringToColor(char.color).color;
    colorBar.fillStyle(color, 1);
    colorBar.fillRoundedRect(0, 0, 6, h, { tl: 10, bl: 10, tr: 0, br: 0 });
    btn.add(colorBar);

    // 角色名称
    const nameText = this.scene.add.text(w / 2 + 3, h / 2, char.name, {
      fontSize: '18px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    nameText.setOrigin(0.5);
    btn.add(nameText);

    const hitArea = this.scene.add.rectangle(w / 2, h / 2, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    btn.setData('bg', bg);
    btn.setData('nameText', nameText);
    btn.setData('index', index);
    btn.setData('color', color);

    hitArea.on('pointerover', () => {
      if (this.currentCharIndex !== index) {
        bg.clear();
        bg.fillStyle(0x3a4a6a, 0.95);
        bg.fillRoundedRect(0, 0, w, h, 10);
        bg.lineStyle(2, color, 0.9);
        bg.strokeRoundedRect(0, 0, w, h, 10);
      }
    });

    hitArea.on('pointerout', () => {
      if (this.currentCharIndex !== index) {
        bg.clear();
        bg.fillStyle(0x2a3a5a, 0.9);
        bg.fillRoundedRect(0, 0, w, h, 10);
        bg.lineStyle(1, 0x4a6a9a, 0.6);
        bg.strokeRoundedRect(0, 0, w, h, 10);
      }
    });

    hitArea.on('pointerdown', () => {
      console.log(`[CharacterGalleryViewScreen] 切换角色: ${char.name}`);
      this.setCharacter(index);
    });

    return btn;
  }

  private updateCharacterButtonStyles(): void {
    const w = 160;
    const h = 80;

    this.characterButtons.forEach(btn => {
      const bg = btn.getData('bg') as Phaser.GameObjects.Graphics;
      const nameText = btn.getData('nameText') as Phaser.GameObjects.Text;
      const index = btn.getData('index') as number;
      const color = btn.getData('color') as number;
      const isActive = this.currentCharIndex === index;

      bg.clear();
      if (isActive) {
        bg.fillStyle(color, 0.3);
        bg.fillRoundedRect(0, 0, w, h, 10);
        bg.lineStyle(3, color, 1);
        bg.strokeRoundedRect(0, 0, w, h, 10);
        nameText.setColor(Phaser.Display.Color.IntegerToColor(color).rgba);
      } else {
        bg.fillStyle(0x2a3a5a, 0.9);
        bg.fillRoundedRect(0, 0, w, h, 10);
        bg.lineStyle(1, 0x4a6a9a, 0.6);
        bg.strokeRoundedRect(0, 0, w, h, 10);
        nameText.setColor('#FFFFFF');
      }
    });
  }

  private setCharacter(index: number): void {
    if (index < 0 || index >= this.characters.length) return;
    this.currentCharIndex = index;
    this.currentExpression = 'default';
    this.updateCharacterButtonStyles();
    this.updateExpressionButtonStyles();
    this.loadSprite();
    this.updateTitle();
  }

  private setExpression(expr: Expression): void {
    this.currentExpression = expr;
    this.updateExpressionButtonStyles();
    this.loadSprite();
  }

  private updateTitle(): void {
    if (this.characters.length === 0) return;
    const char = this.characters[this.currentCharIndex];
    this.nameText.setText(`${this.worldTitle} - ${char.name}`);
    const color = Phaser.Display.Color.HexStringToColor(char.color).rgba;
    this.nameText.setColor(color);
  }

  private async loadCharacters(): Promise<void> {
    try {
      const config = await this.dataProvider.loadWorldConfig(this.worldId);
      if (!config || !config.game.characters) {
        console.error('[CharacterGalleryViewScreen] 无法加载角色数据');
        return;
      }

      // 转换为 CharacterAsset
      this.characters = config.game.characters.map(char => ({
        ...char,
        folder: (char as CharacterAsset).folder || `characters/${char.name}`,
      }));

      console.log(`[CharacterGalleryViewScreen] 加载了 ${this.characters.length} 个角色`);

      this.createCharacterList();
      this.currentCharIndex = 0;
      this.currentExpression = 'default';
      this.updateCharacterButtonStyles();
      this.updateExpressionButtonStyles();
      this.updateTitle();
      this.loadSprite();
    } catch (error) {
      console.error('[CharacterGalleryViewScreen] 加载角色失败:', error);
    }
  }

  private loadSprite(): void {
    if (this.characters.length === 0) return;

    const char = this.characters[this.currentCharIndex];
    const expr = this.currentExpression;

    // 构建图片路径
    let filename: string;
    if (expr === 'default') {
      filename = 'base_sprite.png';
    } else {
      filename = `expression_${expr}.png`;
    }

    const imagePath = `${this.baseUrl}/${this.worldId}/${char.folder}/nobg/${filename}`;
    const textureKey = `char_${this.worldId}_${char.id}_${expr}`;

    console.log(`[CharacterGalleryViewScreen] 加载立绘: ${imagePath}`);

    // 如果纹理已存在，直接显示
    if (this.scene.textures.exists(textureKey)) {
      this.displaySprite(textureKey);
      return;
    }

    // 动态加载
    this.scene.load.image(textureKey, imagePath);
    this.scene.load.once('complete', () => {
      this.loadedTextures.push(textureKey);
      this.displaySprite(textureKey);
    });
    this.scene.load.once('loaderror', () => {
      console.warn(`[CharacterGalleryViewScreen] 加载失败: ${imagePath}`);
      // 尝试加载默认立绘
      if (expr !== 'default') {
        this.setExpression('default');
      }
    });
    this.scene.load.start();
  }

  private displaySprite(textureKey: string): void {
    // 移除旧立绘（保存引用避免异步回调问题）
    const oldSprite = this.currentSprite;
    if (oldSprite) {
      this.scene.tweens.add({
        targets: oldSprite,
        alpha: 0,
        duration: 150,
        onComplete: () => {
          oldSprite.destroy();
        },
      });
    }

    // 创建新立绘
    const sprite = this.scene.add.image(0, 0, textureKey);
    
    // 缩放以适应显示区域（最大高度 480px）
    const maxHeight = 480;
    const scale = maxHeight / sprite.height;
    sprite.setScale(Math.min(scale, 1));
    sprite.setOrigin(0.5, 0.5);
    sprite.setAlpha(0);

    this.spriteContainer.add(sprite);
    this.currentSprite = sprite;

    // 淡入动画
    this.scene.tweens.add({
      targets: sprite,
      alpha: 1,
      duration: 200,
    });
  }

  private createBackButton(): void {
    const btn = this.scene.add.container(80, 660);

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x3a3a5a, 0.9);
    bg.fillRoundedRect(-60, -18, 120, 36, 8);
    bg.lineStyle(1, 0x6a7a9a, 0.8);
    bg.strokeRoundedRect(-60, -18, 120, 36, 8);
    btn.add(bg);

    const text = this.scene.add.text(0, 0, '← 返回', {
      fontSize: '18px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0.5);
    btn.add(text);

    const hitArea = this.scene.add.rectangle(0, 0, 120, 36, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x4a5a7a, 0.95);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
      bg.lineStyle(2, 0xFFD700, 0.9);
      bg.strokeRoundedRect(-60, -18, 120, 36, 8);
      text.setColor('#FFD700');
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x3a3a5a, 0.9);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
      bg.lineStyle(1, 0x6a7a9a, 0.8);
      bg.strokeRoundedRect(-60, -18, 120, 36, 8);
      text.setColor('#FFFFFF');
    });

    hitArea.on('pointerdown', () => {
      console.log('[CharacterGalleryViewScreen] 返回');
      this.screenManager.pop();
    });

    this.container.add(btn);
  }

  private cleanupTextures(): void {
    this.loadedTextures.forEach(key => {
      if (this.scene.textures.exists(key)) {
        this.scene.textures.remove(key);
      }
    });
    this.loadedTextures = [];
  }

  show(params?: Record<string, unknown>): void {
    console.log('[CharacterGalleryViewScreen] 显示', params);

    if (params) {
      this.worldId = (params.worldId as string) || '';
      this.worldTitle = (params.worldTitle as string) || '角色鉴赏';
    }

    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 200,
    });

    // 重置状态
    this.currentCharIndex = 0;
    this.currentExpression = 'default';
    this.autoPlayEnabled = true;
    this.updateAutoPlayStyle();
    this.startAutoPlay();

    // 加载角色数据
    this.loadCharacters();
  }

  hide(): void {
    console.log('[CharacterGalleryViewScreen] 隐藏');
    this.stopAutoPlay();

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        this.container.setVisible(false);
        // 清理立绘
        if (this.currentSprite) {
          this.currentSprite.destroy();
          this.currentSprite = null;
        }
        this.cleanupTextures();
      },
    });
  }

  destroy(): void {
    this.stopAutoPlay();
    this.cleanupTextures();
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
