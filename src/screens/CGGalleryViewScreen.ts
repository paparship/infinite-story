/**
 * CG 画廊视图界面
 * 显示一个世界的所有 CG 图片
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';
import type { DataProvider } from '../data/DataProvider';
import type { WorldConfig, CGConfig } from '../types';

/** 缩略图配置 */
const THUMB_CONFIG = {
  width: 280,
  height: 158, // 16:9
  cols: 4,
  gapX: 20,
  gapY: 20,
  startY: 130,
};

export class CGGalleryViewScreen implements BaseScreen {
  readonly name = 'cgGalleryView';
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;
  private dataProvider: DataProvider;
  
  private worldId: string = '';
  private worldTitle: string = '';
  private galleryContainer!: Phaser.GameObjects.Container;
  private fullscreenContainer: Phaser.GameObjects.Container | null = null;
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
    const bg = this.scene.add.rectangle(640, 360, 1280, 720, 0x0a0a1e, 0.98);
    bg.setInteractive();
    this.container.add(bg);

    this.galleryContainer = this.scene.add.container(0, 0);
    this.container.add(this.galleryContainer);

    this.createBackButton();
  }

  private async loadCGGallery(): Promise<void> {
    this.galleryContainer.removeAll(true);
    this.cleanupTextures();

    // 标题
    const titleText = this.scene.add.text(640, 50, `🖼️ ${this.worldTitle}`, {
      fontSize: '32px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#e0a0d0',
    });
    titleText.setOrigin(0.5);
    this.galleryContainer.add(titleText);

    const subtitle = this.scene.add.text(640, 90, 'CG 画廊 · 点击查看大图', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    subtitle.setOrigin(0.5);
    this.galleryContainer.add(subtitle);

    // 加载配置
    const config = await this.dataProvider.loadWorldConfig(this.worldId);
    if (!config) {
      const error = this.scene.add.text(640, 360, '加载失败', {
        fontSize: '20px',
        color: '#ff6b6b',
      });
      error.setOrigin(0.5);
      this.galleryContainer.add(error);
      return;
    }

    // 加载 CG
    await this.loadCGs(config);
  }

  private async loadCGs(config: WorldConfig): Promise<void> {
    const cgs = config.game.cgs;
    const { width, height, cols, gapX, gapY, startY } = THUMB_CONFIG;
    
    const totalWidth = cols * width + (cols - 1) * gapX;
    const startX = (1280 - totalWidth) / 2;

    // 显示加载进度
    const loadingText = this.scene.add.text(640, 400, `加载中... 0/${cgs.length}`, {
      fontSize: '16px',
      color: '#8aaaca',
    });
    loadingText.setOrigin(0.5);
    this.galleryContainer.add(loadingText);

    // 依次加载 CG
    for (let i = 0; i < cgs.length; i++) {
      const cg = cgs[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (width + gapX) + width / 2;
      const y = startY + row * (height + gapY) + height / 2;

      loadingText.setText(`加载中... ${i + 1}/${cgs.length}`);

      await this.loadCGThumb(cg, x, y, width, height);
    }

    loadingText.destroy();
  }

  private loadCGThumb(cg: CGConfig, x: number, y: number, w: number, h: number): Promise<void> {
    return new Promise((resolve) => {
      const textureKey = `cg_${this.worldId}_${cg.id}`;
      const imagePath = `/assets/worlds/${this.worldId}/${cg.path}`;

      // 占位框
      const placeholder = this.scene.add.graphics();
      placeholder.fillStyle(0x2a3a5a, 0.9);
      placeholder.fillRoundedRect(x - w/2, y - h/2, w, h, 8);
      placeholder.lineStyle(1, 0x4a6a9a, 0.6);
      placeholder.strokeRoundedRect(x - w/2, y - h/2, w, h, 8);
      this.galleryContainer.add(placeholder);

      // 加载图片
      if (this.scene.textures.exists(textureKey)) {
        this.createCGThumb(textureKey, cg, x, y, w, h, placeholder);
        resolve();
      } else {
        this.scene.load.image(textureKey, imagePath);
        this.scene.load.once('complete', () => {
          this.loadedTextures.push(textureKey);
          this.createCGThumb(textureKey, cg, x, y, w, h, placeholder);
          resolve();
        });
        this.scene.load.once('loaderror', () => {
          console.error(`[CGGalleryViewScreen] 加载失败: ${imagePath}`);
          // 显示错误标记
          const errorText = this.scene.add.text(x, y, '❌', { fontSize: '32px' });
          errorText.setOrigin(0.5);
          this.galleryContainer.add(errorText);
          resolve();
        });
        this.scene.load.start();
      }
    });
  }

  private createCGThumb(
    textureKey: string,
    cg: CGConfig,
    x: number, y: number,
    w: number, h: number,
    placeholder: Phaser.GameObjects.Graphics
  ): void {
    // 创建图片
    const img = this.scene.add.image(x, y, textureKey);
    
    // 计算缩放以适应缩略图尺寸
    const scaleX = w / img.width;
    const scaleY = h / img.height;
    const scale = Math.max(scaleX, scaleY); // cover 模式
    img.setScale(scale);
    
    // 创建遮罩（裁剪超出部分）
    const mask = this.scene.add.graphics();
    mask.fillStyle(0xffffff);
    mask.fillRoundedRect(x - w/2, y - h/2, w, h, 8);
    mask.setVisible(false);
    img.setMask(mask.createGeometryMask());
    
    this.galleryContainer.add(img);

    // 标题
    const title = cg.title || cg.name;
    const titleBg = this.scene.add.graphics();
    titleBg.fillStyle(0x000000, 0.7);
    titleBg.fillRect(x - w/2, y + h/2 - 28, w, 28);
    this.galleryContainer.add(titleBg);

    const titleText = this.scene.add.text(x, y + h/2 - 14, title, {
      fontSize: '12px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    titleText.setOrigin(0.5);
    this.galleryContainer.add(titleText);

    // 交互区域
    const hitArea = this.scene.add.rectangle(x, y, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    this.galleryContainer.add(hitArea);

    hitArea.on('pointerover', () => {
      placeholder.clear();
      placeholder.fillStyle(0x3a4a6a, 0.95);
      placeholder.fillRoundedRect(x - w/2, y - h/2, w, h, 8);
      placeholder.lineStyle(2, 0xe0a0d0, 0.9);
      placeholder.strokeRoundedRect(x - w/2, y - h/2, w, h, 8);
    });

    hitArea.on('pointerout', () => {
      placeholder.clear();
      placeholder.fillStyle(0x2a3a5a, 0.9);
      placeholder.fillRoundedRect(x - w/2, y - h/2, w, h, 8);
      placeholder.lineStyle(1, 0x4a6a9a, 0.6);
      placeholder.strokeRoundedRect(x - w/2, y - h/2, w, h, 8);
    });

    hitArea.on('pointerdown', () => {
      console.log(`[CGGalleryViewScreen] 查看大图: ${cg.id}`);
      this.showFullscreen(textureKey, cg);
    });
  }

  private showFullscreen(textureKey: string, cg: CGConfig): void {
    if (this.fullscreenContainer) return;

    this.fullscreenContainer = this.scene.add.container(0, 0);
    this.fullscreenContainer.setDepth(200);

    // 黑色背景
    const overlay = this.scene.add.rectangle(640, 360, 1280, 720, 0x000000, 0.95);
    overlay.setInteractive();
    this.fullscreenContainer.add(overlay);

    // 大图
    const img = this.scene.add.image(640, 360, textureKey);
    const scaleX = 1200 / img.width;
    const scaleY = 650 / img.height;
    const scale = Math.min(scaleX, scaleY);
    img.setScale(scale);
    this.fullscreenContainer.add(img);

    // 标题
    const title = cg.title || cg.name;
    const titleText = this.scene.add.text(640, 680, title, {
      fontSize: '20px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    titleText.setOrigin(0.5);
    this.fullscreenContainer.add(titleText);

    // 关闭提示
    const hint = this.scene.add.text(640, 30, '点击任意位置关闭', {
      fontSize: '14px',
      color: '#8aaaca',
    });
    hint.setOrigin(0.5);
    this.fullscreenContainer.add(hint);

    // 点击关闭
    overlay.on('pointerdown', () => this.closeFullscreen());

    this.container.add(this.fullscreenContainer);
  }

  private closeFullscreen(): void {
    if (this.fullscreenContainer) {
      this.fullscreenContainer.destroy();
      this.fullscreenContainer = null;
    }
  }

  private cleanupTextures(): void {
    this.loadedTextures.forEach(key => {
      if (this.scene.textures.exists(key)) {
        this.scene.textures.remove(key);
      }
    });
    this.loadedTextures = [];
  }

  private createBackButton(): void {
    const btn = this.scene.add.container(640, 680);

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x3a3a5a, 0.9);
    bg.fillRoundedRect(-80, -22, 160, 44, 10);
    bg.lineStyle(1, 0x6a7a9a, 0.8);
    bg.strokeRoundedRect(-80, -22, 160, 44, 10);
    btn.add(bg);

    const text = this.scene.add.text(0, 0, '← 返回', {
      fontSize: '20px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0.5);
    btn.add(text);

    const hitArea = this.scene.add.rectangle(0, 0, 160, 44, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x4a5a7a, 0.95);
      bg.fillRoundedRect(-80, -22, 160, 44, 10);
      bg.lineStyle(2, 0xFFD700, 0.9);
      bg.strokeRoundedRect(-80, -22, 160, 44, 10);
      text.setColor('#FFD700');
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x3a3a5a, 0.9);
      bg.fillRoundedRect(-80, -22, 160, 44, 10);
      bg.lineStyle(1, 0x6a7a9a, 0.8);
      bg.strokeRoundedRect(-80, -22, 160, 44, 10);
      text.setColor('#FFFFFF');
    });

    hitArea.on('pointerdown', () => {
      console.log('[CGGalleryViewScreen] 返回');
      this.screenManager.pop();
    });

    this.container.add(btn);
  }

  show(params?: { worldId: string; worldTitle: string }): void {
    console.log('[CGGalleryViewScreen] 显示', params);
    if (params) {
      this.worldId = params.worldId;
      this.worldTitle = params.worldTitle;
    }
    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 200,
    });
    this.loadCGGallery();
  }

  hide(): void {
    console.log('[CGGalleryViewScreen] 隐藏');
    this.closeFullscreen();
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        this.container.setVisible(false);
        this.cleanupTextures();
      },
    });
  }

  destroy(): void {
    this.closeFullscreen();
    this.cleanupTextures();
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
