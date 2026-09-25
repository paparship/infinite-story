/**
 * 世界选择界面
 * 展示可用世界列表，供玩家选择（支持滚动、存档管理）
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';
import type { DataProvider } from '../data/DataProvider';
import type { WorldInfo } from '../types';

/** 滚动区域配置 */
const SCROLL_CONFIG = {
  top: 130,
  bottom: 620,
  height: 490,
  width: 1000,
};

/** 卡片配置 */
const CARD_CONFIG = {
  width: 920,
  height: 140,
  gap: 16,
  startY: 20,
};

/** 意象名称映射 */
const ATMOSPHERE_NAMES: Record<string, string> = {
  sakura: '🌸 樱花',
  rain: '🌧️ 细雨',
  snow: '❄️ 初雪',
  stars: '✨ 星空',
  leaves: '🍂 落叶',
  hearts: '💕 心动',
  fireflies: '🔥 萤火',
};

/** 语言名称映射 */
const LANGUAGE_NAMES: Record<string, string> = {
  'zh-CN': '简中',
  'zh-TW': '繁中',
  'ja': '日语',
  'ko': '韩语',
  'en': '英语',
  'es': '西语',
  'fr': '法语',
  'de': '德语',
  'pt': '葡语',
  'ru': '俄语',
  'it': '意语',
  'vi': '越语',
  'th': '泰语',
  'id': '印尼语',
  'ar': '阿拉伯语',
};

export class WorldSelectionScreen implements BaseScreen {
  readonly name = 'worldSelection';
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;
  private dataProvider: DataProvider;
  
  // 滚动相关
  private scrollContainer!: Phaser.GameObjects.Container;
  private scrollMask!: Phaser.GameObjects.Graphics;
  private scrollBar!: Phaser.GameObjects.Graphics;
  private scrollThumb!: Phaser.GameObjects.Rectangle;
  private contentHeight: number = 0;
  private scrollY: number = 0;

  // 确认对话框
  private confirmDialog: Phaser.GameObjects.Container | null = null;

  constructor(scene: Phaser.Scene, screenManager: ScreenManager, dataProvider: DataProvider) {
    this.scene = scene;
    this.screenManager = screenManager;
    this.dataProvider = dataProvider;
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(100);
    this.container.setVisible(false);

    this.createStaticUI();
    this.setupScrolling();
    this.createBottomUI();  // 最后创建底部按钮，确保在最上层
  }

  private createStaticUI(): void {
    // 背景（不设置 interactive，避免拦截其他元素的事件）
    const bg = this.scene.add.rectangle(640, 360, 1280, 720, 0x0a0a1e, 0.98);
    this.container.add(bg);

    // 标题
    const title = this.scene.add.text(640, 50, '🌍 选择世界', {
      fontSize: '36px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFD700',
    });
    title.setOrigin(0.5);
    this.container.add(title);

    const subtitle = this.scene.add.text(640, 95, '选择一个已有世界开始游戏，或管理存档', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    subtitle.setOrigin(0.5);
    this.container.add(subtitle);

    // 底部按钮延迟到 setupScrolling 之后创建
  }

  private createBottomUI(): void {
    // 底部按钮（在滚动组件之后创建，确保在最上层）
    this.createBottomButtons();
  }

  private setupScrolling(): void {
    // 创建遮罩
    this.scrollMask = this.scene.add.graphics();
    this.scrollMask.fillStyle(0xffffff);
    this.scrollMask.fillRect(
      640 - SCROLL_CONFIG.width / 2,
      SCROLL_CONFIG.top,
      SCROLL_CONFIG.width,
      SCROLL_CONFIG.height
    );
    this.scrollMask.setVisible(false);

    // 创建滚动容器
    this.scrollContainer = this.scene.add.container(640, SCROLL_CONFIG.top);
    this.scrollContainer.setMask(this.scrollMask.createGeometryMask());
    this.container.add(this.scrollContainer);

    // 创建滚动条轨道
    const trackX = 640 + SCROLL_CONFIG.width / 2 + 15;
    this.scrollBar = this.scene.add.graphics();
    this.scrollBar.fillStyle(0x2a3a4a, 0.8);
    this.scrollBar.fillRoundedRect(trackX, SCROLL_CONFIG.top, 8, SCROLL_CONFIG.height, 4);
    this.container.add(this.scrollBar);

    // 创建滚动条滑块
    this.scrollThumb = this.scene.add.rectangle(trackX + 4, SCROLL_CONFIG.top + 50, 8, 100, 0x6a8aaa);
    this.scrollThumb.setOrigin(0.5, 0);
    this.container.add(this.scrollThumb);

    // 鼠标滚轮滚动
    this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      if (!this.container.visible || this.confirmDialog) return;
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
    const thumbY = SCROLL_CONFIG.top + scrollRatio * trackHeight;
    this.scrollThumb.setY(thumbY);
    
    const needsScroll = this.contentHeight > SCROLL_CONFIG.height;
    this.scrollBar.setVisible(needsScroll);
    this.scrollThumb.setVisible(needsScroll);
  }

  private scroll(delta: number): void {
    this.scrollY += delta;
    this.clampScroll();
    this.updateScrollPosition();
    this.updateScrollBar();
  }

  private clampScroll(): void {
    const maxScroll = Math.max(0, this.contentHeight - SCROLL_CONFIG.height);
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, maxScroll);
  }

  private updateScrollPosition(): void {
    this.scrollContainer.y = SCROLL_CONFIG.top - this.scrollY;
  }

  private async loadWorlds(): Promise<void> {
    this.scrollContainer.removeAll(true);
    this.scrollY = 0;
    this.updateScrollPosition();

    const loading = this.scene.add.text(0, 200, '加载中...', {
      fontSize: '20px',
      color: '#8aaaca',
    });
    loading.setOrigin(0.5);
    this.scrollContainer.add(loading);

    try {
      const worlds = await this.dataProvider.getWorldList();
      loading.destroy();

      if (worlds.length === 0) {
        const empty = this.scene.add.text(0, 200, '暂无可用世界\n请先生成新世界', {
          fontSize: '18px',
          color: '#6a8aaa',
          align: 'center',
        });
        empty.setOrigin(0.5);
        this.scrollContainer.add(empty);
        this.contentHeight = 400;
        return;
      }

      this.createWorldCards(worlds);
      this.updateScrollBar();
    } catch (error) {
      loading.destroy();
      console.error('[WorldSelectionScreen] 加载世界失败:', error);
      const errorText = this.scene.add.text(0, 200, '加载失败，请检查网络', {
        fontSize: '18px',
        color: '#ff6b6b',
        align: 'center',
      });
      errorText.setOrigin(0.5);
      this.scrollContainer.add(errorText);
    }
  }

  private createWorldCards(worlds: WorldInfo[]): void {
    const { width, height, gap, startY } = CARD_CONFIG;
    this.contentHeight = startY + worlds.length * (height + gap) + 40;

    worlds.forEach((world, index) => {
      const y = startY + index * (height + gap) + height / 2;
      const card = this.createWorldCard(world, 0, y, width, height);
      this.scrollContainer.add(card);
    });
  }

  private createWorldCard(
    world: WorldInfo,
    x: number, y: number,
    w: number, h: number
  ): Phaser.GameObjects.Container {
    const card = this.scene.add.container(x, y);

    // 背景
    const bg = this.scene.add.graphics();
    this.drawCardBg(bg, w, h, false);
    card.add(bg);

    // 左侧：世界信息
    const infoX = -w/2 + 20;

    // 图标
    const icon = this.scene.add.text(infoX + 35, -15, '🌏', { fontSize: '32px' });
    icon.setOrigin(0.5, 0.5);
    card.add(icon);

    // 标题
    const title = this.scene.add.text(infoX + 75, -h/2 + 18, world.title, {
      fontSize: '20px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    card.add(title);

    // 描述
    const desc = this.scene.add.text(infoX + 75, -h/2 + 46, world.description, {
      fontSize: '13px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
      wordWrap: { width: 400 },
    });
    card.add(desc);

    // 标签区域（意象 + 语言）
    const atmosphere = world.generationParams?.atmosphere || 'sakura';
    const language = world.generationParams?.language || 'zh-CN';
    const atmosphereName = ATMOSPHERE_NAMES[atmosphere] || atmosphere;
    const languageName = LANGUAGE_NAMES[language] || language;

    // 意象标签
    const tagBg1 = this.scene.add.graphics();
    tagBg1.fillStyle(0x2a4a3a, 0.8);
    tagBg1.fillRoundedRect(infoX + 75, -h/2 + 68, 70, 20, 4);
    card.add(tagBg1);

    const atmosphereTag = this.scene.add.text(infoX + 110, -h/2 + 78, atmosphereName, {
      fontSize: '11px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8dcea0',
    });
    atmosphereTag.setOrigin(0.5);
    card.add(atmosphereTag);

    // 语言标签
    const tagBg2 = this.scene.add.graphics();
    tagBg2.fillStyle(0x3a4a5a, 0.8);
    tagBg2.fillRoundedRect(infoX + 152, -h/2 + 68, 45, 20, 4);
    card.add(tagBg2);

    const langTag = this.scene.add.text(infoX + 175, -h/2 + 78, languageName, {
      fontSize: '11px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#aabbcc',
    });
    langTag.setOrigin(0.5);
    card.add(langTag);

    // 统计信息
    const stats = `角色: ${world.stats.totalCharacters} | CG: ${world.stats.totalCGs} | 章节: ${world.stats.totalChapters}`;
    const statsText = this.scene.add.text(infoX + 75, h/2 - 40, stats, {
      fontSize: '12px',
      color: '#6a8aaa',
    });
    card.add(statsText);

    // 存档信息
    const saveInfo = world.saveSummary;
    if (saveInfo?.hasSave) {
      const saveText = this.scene.add.text(infoX + 75, h/2 - 20, `📍 存档: ${saveInfo.chapterDesc}`, {
        fontSize: '12px',
        color: '#7dcea0',
      });
      card.add(saveText);
    } else {
      const noSaveText = this.scene.add.text(infoX + 75, h/2 - 20, '无存档', {
        fontSize: '12px',
        color: '#5a6a7a',
      });
      card.add(noSaveText);
    }

    // 右侧：按钮区域
    const btnX = w/2 - 180;
    
    if (saveInfo?.hasSave) {
      // 有存档：继续 + 重新开始
      this.createCardButton(card, btnX, -20, 130, 36, '继续', '#3a7a5a', () => {
        console.log(`[WorldSelectionScreen] 继续游戏: ${world.uid}`);
        this.onContinueGame(world);
      });
      
      this.createCardButton(card, btnX, 24, 130, 36, '重新开始', '#5a5a7a', () => {
        console.log(`[WorldSelectionScreen] 重新开始: ${world.uid}`);
        this.showConfirmDialog(
          '重新开始',
          '确定要重新开始吗？\n当前存档将被删除。',
          () => this.onRestartGame(world)
        );
      });
    } else {
      // 无存档：开始游戏
      this.createCardButton(card, btnX, 0, 130, 40, '开始游戏', '#3a6a8a', () => {
        console.log(`[WorldSelectionScreen] 开始游戏: ${world.uid}`);
        this.onStartGame(world);
      });
    }

    // 删除按钮（右上角）
    this.createDeleteButton(card, w/2 - 30, -h/2 + 30, () => {
      console.log(`[WorldSelectionScreen] 删除世界: ${world.uid}`);
      this.showConfirmDialog(
        '删除世界',
        `确定要删除「${world.title}」吗？\n所有资产和存档都将被清除。`,
        () => this.onDeleteWorld(world)
      );
    });

    // 右下角：世界 UID
    const uidText = this.scene.add.text(w/2 - 15, h/2 - 12, world.uid, {
      fontSize: '9px',
      fontFamily: '"Consolas", "Monaco", monospace',
      color: '#4a5a6a',
    });
    uidText.setOrigin(1, 1);
    card.add(uidText);

    // 卡片悬停效果（背景区域）
    const hitArea = this.scene.add.rectangle(-w/4, 0, w/2, h, 0xffffff, 0);
    hitArea.setInteractive();
    card.add(hitArea);

    hitArea.on('pointerover', () => this.drawCardBg(bg, w, h, true));
    hitArea.on('pointerout', () => this.drawCardBg(bg, w, h, false));

    return card;
  }

  private createCardButton(
    card: Phaser.GameObjects.Container,
    x: number, y: number,
    w: number, h: number,
    label: string,
    color: string,
    onClick: () => void
  ): void {
    const btnBg = this.scene.add.graphics();
    const colorNum = parseInt(color.slice(1), 16);
    btnBg.fillStyle(colorNum, 0.9);
    btnBg.fillRoundedRect(x - w/2, y - h/2, w, h, 6);
    card.add(btnBg);

    const btnText = this.scene.add.text(x, y, label, {
      fontSize: '14px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    btnText.setOrigin(0.5);
    card.add(btnText);

    const btnHit = this.scene.add.rectangle(x, y, w, h, 0xffffff, 0);
    btnHit.setInteractive({ useHandCursor: true });
    card.add(btnHit);

    btnHit.on('pointerover', () => {
      btnBg.clear();
      btnBg.fillStyle(colorNum + 0x222222, 1);
      btnBg.fillRoundedRect(x - w/2, y - h/2, w, h, 6);
      btnBg.lineStyle(2, 0xFFD700, 0.8);
      btnBg.strokeRoundedRect(x - w/2, y - h/2, w, h, 6);
    });

    btnHit.on('pointerout', () => {
      btnBg.clear();
      btnBg.fillStyle(colorNum, 0.9);
      btnBg.fillRoundedRect(x - w/2, y - h/2, w, h, 6);
    });

    btnHit.on('pointerdown', onClick);
  }

  private createDeleteButton(
    card: Phaser.GameObjects.Container,
    x: number, y: number,
    onClick: () => void
  ): void {
    const size = 28;
    
    // 红色背景
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x8a3a3a, 0.7);
    bg.fillRoundedRect(x - size/2, y - size/2, size, size, 6);
    card.add(bg);
    
    const btn = this.scene.add.text(x, y, '🗑️', { fontSize: '16px' });
    btn.setOrigin(0.5);
    card.add(btn);

    const hitArea = this.scene.add.rectangle(x, y, size, size, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    card.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0xaa4a4a, 1);
      bg.fillRoundedRect(x - size/2, y - size/2, size, size, 6);
      bg.lineStyle(2, 0xff6b6b, 1);
      bg.strokeRoundedRect(x - size/2, y - size/2, size, size, 6);
    });
    
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x8a3a3a, 0.7);
      bg.fillRoundedRect(x - size/2, y - size/2, size, size, 6);
    });
    
    hitArea.on('pointerdown', onClick);
  }

  private drawCardBg(g: Phaser.GameObjects.Graphics, w: number, h: number, hover: boolean): void {
    g.clear();
    if (hover) {
      g.fillStyle(0x3a4a6a, 0.95);
      g.fillRoundedRect(-w/2, -h/2, w, h, 12);
      g.lineStyle(2, 0x5a8aba, 0.9);
      g.strokeRoundedRect(-w/2, -h/2, w, h, 12);
    } else {
      g.fillStyle(0x2a3a5a, 0.9);
      g.fillRoundedRect(-w/2, -h/2, w, h, 12);
      g.lineStyle(1, 0x4a6a9a, 0.6);
      g.strokeRoundedRect(-w/2, -h/2, w, h, 12);
    }
  }

  // === 游戏操作 ===

  private onStartGame(world: WorldInfo): void {
    console.log(`[WorldSelectionScreen] 开始新游戏 - ${world.uid}`);
    this.screenManager.push('game', {
      worldId: world.uid,
      chapter: 'chapter1',
      line: 0,
      fromSave: false,
    });
  }

  private async onContinueGame(world: WorldInfo): Promise<void> {
    console.log(`[WorldSelectionScreen] 继续游戏 - ${world.uid}`);
    
    // 加载存档数据
    const saveData = await this.dataProvider.getSaveData(world.uid);
    if (saveData) {
      this.screenManager.push('game', {
        worldId: world.uid,
        chapter: saveData.currentChapter,
        line: saveData.currentLine,
        fromSave: true,
        saveData,
      });
    } else {
      // 无存档，从头开始
      this.onStartGame(world);
    }
  }

  private async onRestartGame(world: WorldInfo): Promise<void> {
    console.log(`[WorldSelectionScreen] 重新开始 - ${world.uid}`);
    await this.dataProvider.deleteSaveData(world.uid);
    // 直接开始新游戏，避免回到世界选择并重置滚动条
    this.onStartGame(world);
  }

  private async onDeleteWorld(world: WorldInfo): Promise<void> {
    console.log(`[WorldSelectionScreen] 删除世界 - ${world.uid}`);
    await this.dataProvider.deleteWorld(world.uid);
    this.loadWorlds(); // 刷新列表
  }

  // === 确认对话框 ===

  private showConfirmDialog(title: string, message: string, onConfirm: () => void): void {
    if (this.confirmDialog) return;

    this.confirmDialog = this.scene.add.container(640, 360);
    this.confirmDialog.setDepth(200);

    // 遮罩
    const overlay = this.scene.add.rectangle(0, 0, 1280, 720, 0x000000, 0.7);
    overlay.setInteractive();
    this.confirmDialog.add(overlay);

    // 对话框背景
    const dialogBg = this.scene.add.graphics();
    dialogBg.fillStyle(0x2a3a5a, 1);
    dialogBg.fillRoundedRect(-200, -100, 400, 200, 16);
    dialogBg.lineStyle(2, 0x5a8aba, 1);
    dialogBg.strokeRoundedRect(-200, -100, 400, 200, 16);
    this.confirmDialog.add(dialogBg);

    // 标题
    const titleText = this.scene.add.text(0, -65, title, {
      fontSize: '22px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFD700',
    });
    titleText.setOrigin(0.5);
    this.confirmDialog.add(titleText);

    // 消息
    const msgText = this.scene.add.text(0, -10, message, {
      fontSize: '15px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#CCCCCC',
      align: 'center',
    });
    msgText.setOrigin(0.5);
    this.confirmDialog.add(msgText);

    // 确认按钮
    this.createDialogButton(this.confirmDialog, -70, 60, '确定', '#8a3a3a', () => {
      this.closeConfirmDialog();
      onConfirm();
    });

    // 取消按钮
    this.createDialogButton(this.confirmDialog, 70, 60, '取消', '#3a4a5a', () => {
      this.closeConfirmDialog();
    });

    this.container.add(this.confirmDialog);
  }

  private createDialogButton(
    dialog: Phaser.GameObjects.Container,
    x: number, y: number,
    label: string,
    color: string,
    onClick: () => void
  ): void {
    const colorNum = parseInt(color.slice(1), 16);
    const bg = this.scene.add.graphics();
    bg.fillStyle(colorNum, 1);
    bg.fillRoundedRect(x - 50, y - 18, 100, 36, 8);
    dialog.add(bg);

    const text = this.scene.add.text(x, y, label, {
      fontSize: '15px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0.5);
    dialog.add(text);

    const hit = this.scene.add.rectangle(x, y, 100, 36, 0xffffff, 0);
    hit.setInteractive({ useHandCursor: true });
    dialog.add(hit);

    hit.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(colorNum + 0x222222, 1);
      bg.fillRoundedRect(x - 50, y - 18, 100, 36, 8);
    });

    hit.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(colorNum, 1);
      bg.fillRoundedRect(x - 50, y - 18, 100, 36, 8);
    });

    hit.on('pointerdown', onClick);
  }

  private closeConfirmDialog(): void {
    if (this.confirmDialog) {
      this.confirmDialog.destroy();
      this.confirmDialog = null;
    }
  }

  private createBottomButtons(): void {
    // 返回按钮
    this.createBottomButton(440, 670, '← 返回', '#3a3a5a', () => {
      console.log('[WorldSelectionScreen] 点击: 返回');
      this.screenManager.pop();
    });

    // 创建新世界按钮
    this.createBottomButton(840, 670, '✨ 创建新世界', '#2a5a4a', () => {
      console.log('[WorldSelectionScreen] 点击: 创建新世界');
      this.screenManager.push('worldCreation');
    });
  }

  private createBottomButton(
    x: number, y: number,
    label: string,
    color: string,
    onClick: () => void
  ): void {
    const btn = this.scene.add.container(x, y);
    const colorNum = parseInt(color.slice(1), 16);
    const w = 180, h = 44;

    const bg = this.scene.add.graphics();
    bg.fillStyle(colorNum, 0.9);
    bg.fillRoundedRect(-w/2, -h/2, w, h, 10);
    bg.lineStyle(1, 0x6a7a9a, 0.8);
    bg.strokeRoundedRect(-w/2, -h/2, w, h, 10);
    btn.add(bg);

    const text = this.scene.add.text(0, 0, label, {
      fontSize: '18px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0.5);
    btn.add(text);

    const hitArea = this.scene.add.rectangle(0, 0, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(colorNum + 0x151515, 0.95);
      bg.fillRoundedRect(-w/2, -h/2, w, h, 10);
      bg.lineStyle(2, 0xFFD700, 0.9);
      bg.strokeRoundedRect(-w/2, -h/2, w, h, 10);
      text.setColor('#FFD700');
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(colorNum, 0.9);
      bg.fillRoundedRect(-w/2, -h/2, w, h, 10);
      bg.lineStyle(1, 0x6a7a9a, 0.8);
      bg.strokeRoundedRect(-w/2, -h/2, w, h, 10);
      text.setColor('#FFFFFF');
    });

    hitArea.on('pointerdown', onClick);

    this.container.add(btn);
  }

  show(): void {
    console.log('[WorldSelectionScreen] 显示');
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
    console.log('[WorldSelectionScreen] 隐藏');
    this.closeConfirmDialog();
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 200,
      onComplete: () => this.container.setVisible(false),
    });
  }

  destroy(): void {
    console.log('[WorldSelectionScreen] 销毁');
    this.closeConfirmDialog();
    this.scrollMask.destroy();
    this.scrollBar.destroy();
    this.scrollThumb.destroy();
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
