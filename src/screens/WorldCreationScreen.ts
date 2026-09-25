/**
 * 世界创建界面
 * 让玩家选择特效和语言，然后触发世界生成
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';

/** 可用意象配置 */
const AVAILABLE_EFFECTS = {
  sakura: { name: '🌸 樱花', description: '春日的邂逅', season: '春' },
  rain: { name: '🌧️ 细雨', description: '淅沥的思念', season: '通用' },
  snow: { name: '❄️ 初雪', description: '纯白的约定', season: '冬' },
  stars: { name: '✨ 星空', description: '夜晚的心跳', season: '通用' },
  leaves: { name: '🍂 落叶', description: '秋风的离别', season: '秋' },
  hearts: { name: '💕 心动', description: '怦然的告白', season: '通用' },
  fireflies: { name: '🔥 萤火', description: '夏夜的浪漫', season: '夏' },
} as const;

type EffectType = keyof typeof AVAILABLE_EFFECTS | 'custom';

/** 可用语言配置 */
const AVAILABLE_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', name: 'ไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
];

/** 界面配置 */
const UI_CONFIG = {
  panelWidth: 1000,
  panelHeight: 600,
  effectBtnWidth: 120,
  effectBtnHeight: 65,
  langBtnWidth: 160,
  langBtnHeight: 36,
  gap: 8,
};

export class WorldCreationScreen implements BaseScreen {
  readonly name = 'worldCreation';
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;

  // 当前选择
  private selectedEffect: EffectType = 'sakura';
  private selectedLanguage: string = 'zh-CN';

  // UI 元素
  private effectButtons: Map<string, Phaser.GameObjects.Container> = new Map();
  private languageButtons: Map<string, Phaser.GameObjects.Container> = new Map();
  private createButton!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;

  // 状态
  private isGenerating: boolean = false;

  constructor(scene: Phaser.Scene, screenManager: ScreenManager) {
    this.scene = scene;
    this.screenManager = screenManager;
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(100);
    this.container.setVisible(false);

    this.createUI();
  }

  private createUI(): void {
    const { panelWidth, panelHeight } = UI_CONFIG;
    const centerX = 640;
    const centerY = 360;

    // 背景遮罩
    const overlay = this.scene.add.rectangle(640, 360, 1280, 720, 0x000000, 0.9);
    this.container.add(overlay);

    // 主面板背景
    const panelBg = this.scene.add.graphics();
    panelBg.fillStyle(0x1a2a3a, 0.98);
    panelBg.fillRoundedRect(centerX - panelWidth / 2, centerY - panelHeight / 2, panelWidth, panelHeight, 20);
    panelBg.lineStyle(2, 0x4a6a9a, 0.8);
    panelBg.strokeRoundedRect(centerX - panelWidth / 2, centerY - panelHeight / 2, panelWidth, panelHeight, 20);
    this.container.add(panelBg);

    // 标题
    const title = this.scene.add.text(centerX, centerY - panelHeight / 2 + 35, '✨ 创建新世界', {
      fontSize: '28px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFD700',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5);
    this.container.add(title);

    // 创建特效选择区
    this.createEffectSection(centerX, centerY - 145);

    // 创建语言选择区
    this.createLanguageSection(centerX, centerY + 55);

    // 底部按钮
    this.createBottomButtons(centerX, centerY + panelHeight / 2 - 40);

    // 状态文本
    this.statusText = this.scene.add.text(centerX, centerY + panelHeight / 2 - 70, '', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    this.statusText.setOrigin(0.5);
    this.container.add(this.statusText);
  }

  /** 创建特效选择区 */
  private createEffectSection(centerX: number, startY: number): void {
    // 区域标题
    const sectionTitle = this.scene.add.text(centerX, startY - 50, '💭 你更喜欢什么意象？', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    sectionTitle.setOrigin(0.5);
    this.container.add(sectionTitle);

    // 特效按钮 - 单行排列 7 个
    const effects = Object.entries(AVAILABLE_EFFECTS);
    const { effectBtnWidth, effectBtnHeight, gap } = UI_CONFIG;
    const cols = 7;
    const gridWidth = cols * effectBtnWidth + (cols - 1) * gap;
    const startX = centerX - gridWidth / 2 + effectBtnWidth / 2;

    effects.forEach(([key, config], index) => {
      const x = startX + index * (effectBtnWidth + gap);
      const y = startY;

      const btn = this.createEffectButton(x, y, effectBtnWidth, effectBtnHeight, config.name, config.description, key === this.selectedEffect);
      
      btn.setData('effectKey', key);
      const hitArea = btn.getAt(btn.length - 1) as Phaser.GameObjects.Rectangle;
      hitArea.on('pointerdown', () => {
        if (this.isGenerating) return;
        this.selectEffect(key as EffectType);
      });

      this.effectButtons.set(key, btn);
      this.container.add(btn);
    });

    // 自定义按钮 - 在下方
    this.createCustomEffectOption(centerX, startY + effectBtnHeight + 15);
  }

  /** 创建自定义意象选项 */
  private createCustomEffectOption(centerX: number, y: number): void {
    const customBtn = this.scene.add.container(centerX, y);

    // 背景
    const bg = this.scene.add.graphics();
    const w = 300;
    const h = 36;
    this.drawOptionBg(bg, w, h, this.selectedEffect === 'custom');
    customBtn.add(bg);

    // 文本 "✏️ 或者，输入你的意象..."
    const labelText = this.scene.add.text(0, 0, '✏️ 或者，输入你的意象...', {
      fontSize: '14px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: this.selectedEffect === 'custom' ? '#FFD700' : '#8aaaca',
    });
    labelText.setOrigin(0.5);
    customBtn.add(labelText);

    // 点击区域
    const hitArea = this.scene.add.rectangle(0, 0, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    customBtn.add(hitArea);

    hitArea.on('pointerover', () => {
      if (this.selectedEffect !== 'custom') {
        this.drawOptionBg(bg, w, h, false, true);
        labelText.setColor('#FFFFFF');
      }
    });
    hitArea.on('pointerout', () => {
      if (this.selectedEffect !== 'custom') {
        this.drawOptionBg(bg, w, h, false, false);
        labelText.setColor('#8aaaca');
      }
    });
    hitArea.on('pointerdown', () => {
      if (this.isGenerating) return;
      this.selectEffect('custom');
    });

    customBtn.setData('selected', this.selectedEffect === 'custom');
    customBtn.setData('bg', bg);
    customBtn.setData('labelText', labelText);

    this.effectButtons.set('custom', customBtn);
    this.container.add(customBtn);
  }

  /** 创建语言选择区 */
  private createLanguageSection(centerX: number, startY: number): void {
    // 区域标题
    const sectionTitle = this.scene.add.text(centerX, startY - 50, '🌍 选择目标语言', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    sectionTitle.setOrigin(0.5);
    this.container.add(sectionTitle);

    // 语言按钮网格 - 5列3行
    const cols = 5;
    const { langBtnWidth, langBtnHeight, gap } = UI_CONFIG;
    const gridWidth = cols * langBtnWidth + (cols - 1) * gap;
    const startX = centerX - gridWidth / 2 + langBtnWidth / 2;

    AVAILABLE_LANGUAGES.forEach((lang, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (langBtnWidth + gap);
      const y = startY + row * (langBtnHeight + gap);

      const btn = this.createLanguageButton(x, y, langBtnWidth, langBtnHeight, `${lang.flag} ${lang.name}`, lang.code === this.selectedLanguage);
      
      btn.setData('langCode', lang.code);
      const hitArea = btn.getAt(btn.length - 1) as Phaser.GameObjects.Rectangle;
      hitArea.on('pointerdown', () => {
        if (this.isGenerating) return;
        this.selectLanguage(lang.code);
      });

      this.languageButtons.set(lang.code, btn);
      this.container.add(btn);
    });
  }

  /** 创建特效按钮 */
  private createEffectButton(x: number, y: number, w: number, h: number, label: string, desc: string, selected: boolean): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);

    const bg = this.scene.add.graphics();
    this.drawOptionBg(bg, w, h, selected);
    btn.add(bg);

    // 提取 emoji 和文字
    const emoji = label.substring(0, 2);
    const text = label.substring(2).trim();

    const emojiText = this.scene.add.text(0, -12, emoji, {
      fontSize: '20px',
    });
    emojiText.setOrigin(0.5);
    btn.add(emojiText);

    const labelText = this.scene.add.text(0, 10, text, {
      fontSize: '12px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: selected ? '#FFD700' : '#FFFFFF',
      fontStyle: 'bold',
    });
    labelText.setOrigin(0.5);
    btn.add(labelText);

    const descText = this.scene.add.text(0, 26, desc, {
      fontSize: '9px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    descText.setOrigin(0.5);
    btn.add(descText);

    const hitArea = this.scene.add.rectangle(0, 0, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      if (!btn.getData('selected')) {
        this.drawOptionBg(bg, w, h, false, true);
      }
    });
    hitArea.on('pointerout', () => {
      if (!btn.getData('selected')) {
        this.drawOptionBg(bg, w, h, false, false);
      }
    });

    btn.setData('selected', selected);
    btn.setData('bg', bg);
    btn.setData('labelText', labelText);
    btn.setData('w', w);
    btn.setData('h', h);

    return btn;
  }

  /** 创建语言按钮 */
  private createLanguageButton(x: number, y: number, w: number, h: number, label: string, selected: boolean): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);

    const bg = this.scene.add.graphics();
    this.drawOptionBg(bg, w, h, selected);
    btn.add(bg);

    const labelText = this.scene.add.text(0, 0, label, {
      fontSize: '13px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: selected ? '#FFD700' : '#FFFFFF',
    });
    labelText.setOrigin(0.5);
    btn.add(labelText);

    const hitArea = this.scene.add.rectangle(0, 0, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      if (!btn.getData('selected')) {
        this.drawOptionBg(bg, w, h, false, true);
      }
    });
    hitArea.on('pointerout', () => {
      if (!btn.getData('selected')) {
        this.drawOptionBg(bg, w, h, false, false);
      }
    });

    btn.setData('selected', selected);
    btn.setData('bg', bg);
    btn.setData('labelText', labelText);

    return btn;
  }

  /** 绘制选项背景 */
  private drawOptionBg(graphics: Phaser.GameObjects.Graphics, w: number, h: number, selected: boolean, hover: boolean = false): void {
    graphics.clear();

    if (selected) {
      graphics.fillStyle(0x2a5a4a, 1);
      graphics.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      graphics.lineStyle(2, 0xFFD700, 1);
      graphics.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    } else if (hover) {
      graphics.fillStyle(0x3a4a5a, 1);
      graphics.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      graphics.lineStyle(1, 0x6a8aaa, 0.8);
      graphics.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    } else {
      graphics.fillStyle(0x2a3a4a, 0.8);
      graphics.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      graphics.lineStyle(1, 0x4a6a8a, 0.5);
      graphics.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    }
  }

  /** 选择特效 */
  private selectEffect(effect: EffectType): void {
    const { effectBtnWidth, effectBtnHeight } = UI_CONFIG;
    
    // 取消之前选择
    const prevBtn = this.effectButtons.get(this.selectedEffect);
    if (prevBtn) {
      // 自定义按钮尺寸不同
      const isCustomPrev = this.selectedEffect === 'custom';
      const prevW = isCustomPrev ? 300 : effectBtnWidth;
      const prevH = isCustomPrev ? 36 : effectBtnHeight;
      this.updateButtonState(prevBtn, false, prevW, prevH);
      // 自定义按钮文字颜色特殊处理
      if (isCustomPrev) {
        const labelText = prevBtn.getData('labelText') as Phaser.GameObjects.Text;
        labelText.setColor('#8aaaca');
      }
    }

    // 选择新的
    this.selectedEffect = effect;
    const newBtn = this.effectButtons.get(effect);
    if (newBtn) {
      const isCustomNew = effect === 'custom';
      const newW = isCustomNew ? 300 : effectBtnWidth;
      const newH = isCustomNew ? 36 : effectBtnHeight;
      this.updateButtonState(newBtn, true, newW, newH);
    }

    // 如果选择自定义，显示开发中提示
    if (effect === 'custom') {
      this.showCustomEffectNotice();
    }

    console.log(`[WorldCreationScreen] 选择特效: ${effect}`);
  }

  /** 显示自定义功能开发中提示 */
  private showCustomEffectNotice(): void {
    this.statusText.setText('🚧 自定义意象功能正在开发中...');
    this.statusText.setColor('#FF9800');
    this.statusText.setFontSize(14);
  }

  /** 选择语言 */
  private selectLanguage(langCode: string): void {
    const { langBtnWidth, langBtnHeight } = UI_CONFIG;
    
    // 取消之前选择
    const prevBtn = this.languageButtons.get(this.selectedLanguage);
    if (prevBtn) {
      this.updateButtonState(prevBtn, false, langBtnWidth, langBtnHeight);
    }

    // 选择新的
    this.selectedLanguage = langCode;
    const newBtn = this.languageButtons.get(langCode);
    if (newBtn) {
      this.updateButtonState(newBtn, true, langBtnWidth, langBtnHeight);
    }

    console.log(`[WorldCreationScreen] 选择语言: ${langCode}`);
  }

  /** 更新按钮状态 */
  private updateButtonState(btn: Phaser.GameObjects.Container, selected: boolean, w: number, h: number): void {
    btn.setData('selected', selected);
    const bg = btn.getData('bg') as Phaser.GameObjects.Graphics;
    const labelText = btn.getData('labelText') as Phaser.GameObjects.Text;
    
    this.drawOptionBg(bg, w, h, selected);
    labelText.setColor(selected ? '#FFD700' : '#FFFFFF');
  }

  /** 创建底部按钮 */
  private createBottomButtons(centerX: number, y: number): void {
    // 返回按钮
    const backBtn = this.createActionButton(centerX - 120, y, 180, 50, '← 返回', '#4a5a6a');
    const backHit = backBtn.getAt(backBtn.length - 1) as Phaser.GameObjects.Rectangle;
    backHit.on('pointerdown', () => {
      if (this.isGenerating) return;
      this.screenManager.pop();
    });
    this.container.add(backBtn);

    // 创建按钮
    this.createButton = this.createActionButton(centerX + 120, y, 180, 50, '🚀 开始创建', '#2a6a4a');
    const createHit = this.createButton.getAt(this.createButton.length - 1) as Phaser.GameObjects.Rectangle;
    createHit.on('pointerdown', () => {
      if (this.isGenerating) return;
      this.startGeneration();
    });
    this.container.add(this.createButton);
  }

  /** 创建操作按钮 */
  private createActionButton(x: number, y: number, w: number, h: number, label: string, color: string): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);

    const bg = this.scene.add.graphics();
    const colorNum = parseInt(color.replace('#', ''), 16);
    bg.fillStyle(colorNum, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.lineStyle(2, 0xffffff, 0.3);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    btn.add(bg);

    const text = this.scene.add.text(0, 0, label, {
      fontSize: '18px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    text.setOrigin(0.5);
    btn.add(text);

    const hitArea = this.scene.add.rectangle(0, 0, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(colorNum + 0x111111, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(2, 0xffffff, 0.5);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    });
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(colorNum, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(2, 0xffffff, 0.3);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    });

    return btn;
  }

  /** 生成服务器地址 */
  private static readonly API_BASE = 'http://localhost:3010';

  /** 开始生成世界 */
  private async startGeneration(): Promise<void> {
    // 如果选择了自定义，提示正在开发中
    if (this.selectedEffect === 'custom') {
      this.statusText.setText('🚧 自定义意象功能正在开发中，请先选择预设意象');
      this.statusText.setColor('#FF9800');
      this.statusText.setFontSize(14);
      return;
    }

    this.isGenerating = true;
    this.statusText.setText('🔄 正在连接生成服务...');
    this.statusText.setColor('#FFD700');

    console.log(`[WorldCreationScreen] 开始生成世界`);
    console.log(`  特效: ${this.selectedEffect}`);
    console.log(`  语言: ${this.selectedLanguage}`);

    try {
      // 先检查服务器是否可用
      const healthCheck = await fetch(`${WorldCreationScreen.API_BASE}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });

      if (!healthCheck.ok) {
        throw new Error('服务器不可用');
      }

      // 调用生成 API
      const response = await fetch(`${WorldCreationScreen.API_BASE}/api/generate-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effect: this.selectedEffect,
          language: this.selectedLanguage,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`[WorldCreationScreen] 生成已启动: ${result.worldId}`);
        
        // 跳转到生成进度页面
        this.screenManager.push('worldGeneration', { worldId: result.worldId });
      } else {
        throw new Error(`API 错误: ${response.status}`);
      }
    } catch (error) {
      console.error('[WorldCreationScreen] 连接失败:', error);
      
      // 服务器不可用，显示启动提示
      this.statusText.setText(
        `⚠️ 生成服务未运行\n\n请先在终端启动服务:\ncd playgrounds/galagame_v2/src/agents\nGENERATION_PORT=3010 npx tsx generation-server.ts`
      );
      this.statusText.setColor('#FF9800');
      this.statusText.setFontSize(14);
      this.isGenerating = false;
    }
  }

  // === BaseScreen 接口 ===

  show(_params?: Record<string, unknown>): void {
    console.log('[WorldCreationScreen] 显示');
    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.isGenerating = false;
    this.statusText.setText('');

    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 300,
    });
  }

  hide(): void {
    console.log('[WorldCreationScreen] 隐藏');
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        this.container.setVisible(false);
      },
    });
  }

  destroy(): void {
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
