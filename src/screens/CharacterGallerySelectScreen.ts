/**
 * 角色鉴赏 - 世界选择界面
 * 选择一个世界查看其角色立绘
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';
import type { DataProvider } from '../data/DataProvider';
import type { WorldInfo } from '../types';

const SCROLL_CONFIG = {
  top: 130,
  height: 480,
  width: 800,
};

export class CharacterGallerySelectScreen implements BaseScreen {
  readonly name = 'characterGallerySelect';
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;
  private dataProvider: DataProvider;
  
  private scrollContainer!: Phaser.GameObjects.Container;
  private scrollMask!: Phaser.GameObjects.Graphics;
  private scrollBar!: Phaser.GameObjects.Graphics;
  private scrollThumb!: Phaser.GameObjects.Rectangle;
  private contentHeight: number = 0;
  private scrollY: number = 0;

  constructor(scene: Phaser.Scene, screenManager: ScreenManager, dataProvider: DataProvider) {
    this.scene = scene;
    this.screenManager = screenManager;
    this.dataProvider = dataProvider;
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(100);
    this.container.setVisible(false);

    this.createStaticUI();
    this.setupScrolling();
  }

  private createStaticUI(): void {
    const bg = this.scene.add.rectangle(640, 360, 1280, 720, 0x0a0a1e, 0.98);
    bg.setInteractive();
    this.container.add(bg);

    const title = this.scene.add.text(640, 50, '👤 角色鉴赏', {
      fontSize: '36px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFB7C5',
    });
    title.setOrigin(0.5);
    this.container.add(title);

    const subtitle = this.scene.add.text(640, 95, '选择一个世界查看角色立绘', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    subtitle.setOrigin(0.5);
    this.container.add(subtitle);

    this.createBackButton();
  }

  private setupScrolling(): void {
    this.scrollMask = this.scene.add.graphics();
    this.scrollMask.fillStyle(0xffffff);
    this.scrollMask.fillRect(
      640 - SCROLL_CONFIG.width / 2,
      SCROLL_CONFIG.top,
      SCROLL_CONFIG.width,
      SCROLL_CONFIG.height
    );
    this.scrollMask.setVisible(false);

    this.scrollContainer = this.scene.add.container(640, SCROLL_CONFIG.top);
    this.scrollContainer.setMask(this.scrollMask.createGeometryMask());
    this.container.add(this.scrollContainer);

    const trackX = 640 + SCROLL_CONFIG.width / 2 + 15;
    this.scrollBar = this.scene.add.graphics();
    this.scrollBar.fillStyle(0x2a3a4a, 0.8);
    this.scrollBar.fillRoundedRect(trackX, SCROLL_CONFIG.top, 8, SCROLL_CONFIG.height, 4);
    this.container.add(this.scrollBar);

    this.scrollThumb = this.scene.add.rectangle(trackX + 4, SCROLL_CONFIG.top + 50, 8, 100, 0x6a8aaa);
    this.scrollThumb.setOrigin(0.5, 0);
    this.container.add(this.scrollThumb);

    this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      if (!this.container.visible) return;
      this.scroll(deltaY * 0.5);
    });
  }

  private updateScrollBar(): void {
    if (!this.scrollThumb) return;
    const maxScroll = Math.max(1, this.contentHeight - SCROLL_CONFIG.height);
    const scrollRatio = this.scrollY / maxScroll;
    const thumbHeight = Math.max(40, (SCROLL_CONFIG.height / this.contentHeight) * SCROLL_CONFIG.height);
    this.scrollThumb.setSize(8, thumbHeight);
    const trackHeight = SCROLL_CONFIG.height - thumbHeight;
    this.scrollThumb.setY(SCROLL_CONFIG.top + scrollRatio * trackHeight);
    const needsScroll = this.contentHeight > SCROLL_CONFIG.height;
    this.scrollBar.setVisible(needsScroll);
    this.scrollThumb.setVisible(needsScroll);
  }

  private scroll(delta: number): void {
    this.scrollY += delta;
    const maxScroll = Math.max(0, this.contentHeight - SCROLL_CONFIG.height);
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, maxScroll);
    this.scrollContainer.y = SCROLL_CONFIG.top - this.scrollY;
    this.updateScrollBar();
  }

  private async loadWorlds(): Promise<void> {
    this.scrollContainer.removeAll(true);
    this.scrollY = 0;
    this.scrollContainer.y = SCROLL_CONFIG.top;

    const loading = this.scene.add.text(0, 150, '加载中...', {
      fontSize: '20px',
      color: '#8aaaca',
    });
    loading.setOrigin(0.5);
    this.scrollContainer.add(loading);

    try {
      const worlds = await this.dataProvider.getWorldList();
      loading.destroy();

      if (worlds.length === 0) {
        const empty = this.scene.add.text(0, 150, '暂无可用世界', {
          fontSize: '18px',
          color: '#6a8aaa',
        });
        empty.setOrigin(0.5);
        this.scrollContainer.add(empty);
        this.contentHeight = 300;
        return;
      }

      this.createWorldList(worlds);
      this.updateScrollBar();
    } catch (error) {
      loading.destroy();
      console.error('[CharacterGallerySelectScreen] 加载失败:', error);
    }
  }

  private createWorldList(worlds: WorldInfo[]): void {
    const itemHeight = 70;
    const gap = 12;
    const startY = 40;
    this.contentHeight = startY + worlds.length * (itemHeight + gap) + 40;

    worlds.forEach((world, index) => {
      const y = startY + index * (itemHeight + gap);
      this.createWorldItem(world, 0, y, 700, itemHeight);
    });
  }

  private createWorldItem(world: WorldInfo, x: number, y: number, w: number, h: number): void {
    const item = this.scene.add.container(x, y);

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x2a3a5a, 0.9);
    bg.fillRoundedRect(-w/2, 0, w, h, 10);
    bg.lineStyle(1, 0x4a6a9a, 0.6);
    bg.strokeRoundedRect(-w/2, 0, w, h, 10);
    item.add(bg);

    const icon = this.scene.add.text(-w/2 + 40, h/2, '👤', { fontSize: '28px' });
    icon.setOrigin(0.5);
    item.add(icon);

    const title = this.scene.add.text(-w/2 + 80, h/2 - 12, world.title, {
      fontSize: '18px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    item.add(title);

    const stats = `${world.stats.totalCharacters} 位角色`;
    const statsText = this.scene.add.text(-w/2 + 80, h/2 + 12, stats, {
      fontSize: '13px',
      color: '#FFB7C5',
    });
    item.add(statsText);

    const arrow = this.scene.add.text(w/2 - 40, h/2, '→', {
      fontSize: '24px',
      color: '#FFB7C5',
    });
    arrow.setOrigin(0.5);
    item.add(arrow);

    const hitArea = this.scene.add.rectangle(0, h/2, w, h, 0xffffff, 0);
    const hitShape = new Phaser.Geom.Rectangle(-w / 2, 0, w, h);
    hitArea.setInteractive(hitShape, (_shape, localX, localY) => {
      if (!Phaser.Geom.Rectangle.Contains(hitShape, localX, localY)) return false;
      const worldY = this.scrollContainer.y + item.y + localY;
      return this.isInScrollViewport(worldY);
    });
    item.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x3a4a6a, 0.95);
      bg.fillRoundedRect(-w/2, 0, w, h, 10);
      bg.lineStyle(2, 0xFFB7C5, 0.9);
      bg.strokeRoundedRect(-w/2, 0, w, h, 10);
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x2a3a5a, 0.9);
      bg.fillRoundedRect(-w/2, 0, w, h, 10);
      bg.lineStyle(1, 0x4a6a9a, 0.6);
      bg.strokeRoundedRect(-w/2, 0, w, h, 10);
    });

    hitArea.on('pointerdown', () => {
      console.log(`[CharacterGallerySelectScreen] 查看角色: ${world.uid}`);
      this.screenManager.push('characterGalleryView', { worldId: world.uid, worldTitle: world.title });
    });

    this.scrollContainer.add(item);
  }

  private isInScrollViewport(worldY: number): boolean {
    const top = SCROLL_CONFIG.top;
    const bottom = SCROLL_CONFIG.top + SCROLL_CONFIG.height;
    return worldY >= top && worldY <= bottom;
  }

  private createBackButton(): void {
    const btn = this.scene.add.container(640, 660);

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
      console.log('[CharacterGallerySelectScreen] 返回');
      this.screenManager.pop();
    });

    this.container.add(btn);
  }

  show(): void {
    console.log('[CharacterGallerySelectScreen] 显示');
    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 200,
    });
    this.loadWorlds();
  }

  hide(): void {
    console.log('[CharacterGallerySelectScreen] 隐藏');
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 200,
      onComplete: () => this.container.setVisible(false),
    });
  }

  destroy(): void {
    this.scrollMask.destroy();
    this.scrollBar.destroy();
    this.scrollThumb.destroy();
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
