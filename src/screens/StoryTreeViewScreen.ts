/**
 * 剧情树视图界面
 * 可视化显示一个世界的剧情分支结构
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';
import type { DataProvider } from '../data/DataProvider';
import type { WorldConfig } from '../types';

/** 节点配置 */
const NODE_CONFIG = {
  width: 160,
  height: 50,
  gapX: 60,
  gapY: 80,
};

/** 颜色配置 */
const COLORS = {
  common: 0x4a7a9a,
  route_a: 0xFFB7C5,
  route_b: 0x87CEEB,
  route_c: 0xDDA0DD,
  ending: 0xFFD700,
  line: 0x5a7a9a,
};

interface TreeNode {
  id: string;
  title: string;
  type: 'common' | 'route' | 'ending';
  routeKey?: string;
  x: number;
  y: number;
}

export class StoryTreeViewScreen implements BaseScreen {
  readonly name = 'storyTreeView';
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;
  private dataProvider: DataProvider;
  
  private worldId: string = '';
  private worldTitle: string = '';
  private treeContainer!: Phaser.GameObjects.Container;

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

    this.treeContainer = this.scene.add.container(640, 320);
    this.container.add(this.treeContainer);

    this.createBackButton();
  }

  private async loadStoryTree(): Promise<void> {
    this.treeContainer.removeAll(true);

    // 显示标题
    const titleText = this.scene.add.text(640, 50, `🌳 ${this.worldTitle}`, {
      fontSize: '32px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#7dcea0',
    });
    titleText.setOrigin(0.5);
    this.container.add(titleText);

    const subtitle = this.scene.add.text(640, 90, '剧情分支结构', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    subtitle.setOrigin(0.5);
    this.container.add(subtitle);

    // 加载世界配置
    const config = await this.dataProvider.loadWorldConfig(this.worldId);
    if (!config) {
      const error = this.scene.add.text(0, 0, '加载失败', {
        fontSize: '20px',
        color: '#ff6b6b',
      });
      error.setOrigin(0.5);
      this.treeContainer.add(error);
      return;
    }

    this.renderTree(config);
  }

  private renderTree(config: WorldConfig): void {
    const nodes: TreeNode[] = [];
    const { width, height, gapX, gapY } = NODE_CONFIG;

    // 共同路线节点
    const commonY = -180;
    config.game.chapters.common.forEach((ch, i) => {
      nodes.push({
        id: ch.id,
        title: ch.title,
        type: 'common',
        x: 0,
        y: commonY + i * gapY,
      });
    });

    // 分支路线节点
    const routeKeys = Object.keys(config.game.chapters.routes);
    const routeCount = routeKeys.length;
    const routeStartX = -((routeCount - 1) * (width + gapX)) / 2;

    routeKeys.forEach((routeKey, routeIdx) => {
      const chapters = config.game.chapters.routes[routeKey];
      const x = routeStartX + routeIdx * (width + gapX);
      
      chapters.forEach((ch, chIdx) => {
        nodes.push({
          id: ch.id,
          title: ch.title,
          type: 'route',
          routeKey,
          x,
          y: commonY + gapY + (chIdx + 1) * gapY,
        });
      });
    });

    // 结局节点
    config.game.endings.forEach((ending, idx) => {
      const x = routeStartX + idx * (width + gapX);
      nodes.push({
        id: ending.id,
        title: ending.title,
        type: 'ending',
        routeKey: ending.characterId,
        x,
        y: commonY + gapY * 4,
      });
    });

    // 绘制连线
    this.drawConnections(nodes, routeCount, commonY);

    // 绘制节点
    nodes.forEach(node => this.drawNode(node));

    // 绘制图例
    this.drawLegend(config);
  }

  private drawConnections(nodes: TreeNode[], routeCount: number, commonY: number): void {
    const graphics = this.scene.add.graphics();
    graphics.lineStyle(2, COLORS.line, 0.6);

    const { width, gapX, gapY } = NODE_CONFIG;
    const routeStartX = -((routeCount - 1) * (width + gapX)) / 2;

    // 共同路线 → 分支点
    graphics.beginPath();
    graphics.moveTo(0, commonY + 25);
    graphics.lineTo(0, commonY + gapY - 25);
    graphics.strokePath();

    // 分支点 → 各路线
    for (let i = 0; i < routeCount; i++) {
      const x = routeStartX + i * (width + gapX);
      
      // 水平线
      graphics.beginPath();
      graphics.moveTo(0, commonY + gapY - 25);
      graphics.lineTo(x, commonY + gapY - 25);
      graphics.strokePath();
      
      // 垂直线到第二章
      graphics.beginPath();
      graphics.moveTo(x, commonY + gapY - 25);
      graphics.lineTo(x, commonY + gapY + gapY - 25);
      graphics.strokePath();

      // 第二章 → 第三章
      graphics.beginPath();
      graphics.moveTo(x, commonY + gapY + gapY + 25);
      graphics.lineTo(x, commonY + gapY * 3 - 25);
      graphics.strokePath();

      // 第三章 → 结局
      graphics.beginPath();
      graphics.moveTo(x, commonY + gapY * 3 + 25);
      graphics.lineTo(x, commonY + gapY * 4 - 25);
      graphics.strokePath();
    }

    this.treeContainer.add(graphics);
  }

  private drawNode(node: TreeNode): void {
    const { width, height } = NODE_CONFIG;
    const nodeContainer = this.scene.add.container(node.x, node.y);

    // 确定颜色
    let color = COLORS.common;
    if (node.type === 'ending') {
      color = COLORS.ending;
    } else if (node.routeKey) {
      if (node.routeKey === 'char_1') color = COLORS.route_a;
      else if (node.routeKey === 'char_2') color = COLORS.route_b;
      else if (node.routeKey === 'char_3') color = COLORS.route_c;
    }

    // 背景
    const bg = this.scene.add.graphics();
    bg.fillStyle(color, 0.9);
    bg.fillRoundedRect(-width/2, -height/2, width, height, 8);
    bg.lineStyle(2, 0xffffff, 0.3);
    bg.strokeRoundedRect(-width/2, -height/2, width, height, 8);
    nodeContainer.add(bg);

    // 标题（截断长标题）
    let displayTitle = node.title;
    if (displayTitle.length > 8) {
      displayTitle = displayTitle.substring(0, 7) + '…';
    }

    const text = this.scene.add.text(0, 0, displayTitle, {
      fontSize: '14px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: node.type === 'ending' ? '#1a1a2e' : '#FFFFFF',
      fontStyle: 'bold',
    });
    text.setOrigin(0.5);
    nodeContainer.add(text);

    // 交互
    const hitArea = this.scene.add.rectangle(0, 0, width, height, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    nodeContainer.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(color, 1);
      bg.fillRoundedRect(-width/2, -height/2, width, height, 8);
      bg.lineStyle(3, 0xFFD700, 0.9);
      bg.strokeRoundedRect(-width/2, -height/2, width, height, 8);
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(color, 0.9);
      bg.fillRoundedRect(-width/2, -height/2, width, height, 8);
      bg.lineStyle(2, 0xffffff, 0.3);
      bg.strokeRoundedRect(-width/2, -height/2, width, height, 8);
    });

    hitArea.on('pointerdown', () => {
      console.log(`[StoryTreeViewScreen] 点击节点: ${node.id} - ${node.title}`);
    });

    this.treeContainer.add(nodeContainer);
  }

  private drawLegend(config: WorldConfig): void {
    // 图例放在树下方
    const legendY = 320;
    const totalWidth = 520;
    const chars = config.game.characters;
    const legends = [
      { color: COLORS.common, label: '共同路线' },
      { color: COLORS.route_a, label: chars[0]?.name || '路线A' },
      { color: COLORS.route_b, label: chars[1]?.name || '路线B' },
      { color: COLORS.route_c, label: chars[2]?.name || '路线C' },
    ];

    const gap = totalWidth / legends.length;
    const startX = -totalWidth / 2 + gap / 2;

    legends.forEach((item, idx) => {
      const x = startX + idx * gap;
      
      const dot = this.scene.add.graphics();
      dot.fillStyle(item.color, 1);
      dot.fillCircle(x - 35, legendY, 8);
      this.treeContainer.add(dot);

      const label = this.scene.add.text(x - 20, legendY, item.label, {
        fontSize: '14px',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        color: '#9abacc',
      });
      label.setOrigin(0, 0.5);
      this.treeContainer.add(label);
    });
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
      console.log('[StoryTreeViewScreen] 返回');
      this.screenManager.pop();
    });

    this.container.add(btn);
  }

  show(params?: { worldId: string; worldTitle: string }): void {
    console.log('[StoryTreeViewScreen] 显示', params);
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
    this.loadStoryTree();
  }

  hide(): void {
    console.log('[StoryTreeViewScreen] 隐藏');
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 200,
      onComplete: () => this.container.setVisible(false),
    });
  }

  destroy(): void {
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
