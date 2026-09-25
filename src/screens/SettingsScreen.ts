/**
 * 游戏设置界面
 * 支持音量调节、特效预览，设置保存到 localStorage
 */

import Phaser from 'phaser';
import type { BaseScreen } from './BaseScreen';
import type { ScreenManager } from '../core/ScreenManager';
import { EffectManager, type EffectType } from '../ui/EffectManager';

/** 设置存储 key */
const SETTINGS_KEY = 'game_settings';

/** 默认设置 */
const DEFAULT_SETTINGS = {
  masterVolume: 0.8,
  bgmVolume: 0.7,
  sfxVolume: 0.8,
  textSpeed: 0.5,
  autoPlaySpeed: 0.5,
};

/** 设置数据类型 */
interface GameSettings {
  masterVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  textSpeed: number;
  autoPlaySpeed: number;
}

/** 滑块组件 */
interface SliderComponent {
  bg: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  handle: Phaser.GameObjects.Arc;
  value: number;
  key: keyof GameSettings;
}

/** 特效配置 */
const EFFECTS_LIST: { type: EffectType; name: string; icon: string }[] = [
  { type: 'sakura', name: '樱花', icon: '🌸' },
  { type: 'rain', name: '细雨', icon: '🌧️' },
  { type: 'snow', name: '初雪', icon: '❄️' },
  { type: 'stars', name: '星空', icon: '✨' },
  { type: 'leaves', name: '落叶', icon: '🍂' },
  { type: 'hearts', name: '心动', icon: '💕' },
  { type: 'fireflies', name: '萤火', icon: '🔥' },
];

export class SettingsScreen implements BaseScreen {
  readonly name = 'settings';
  readonly container: Phaser.GameObjects.Container;
  
  private scene: Phaser.Scene;
  private screenManager: ScreenManager;
  private settings: GameSettings;
  private sliders: SliderComponent[] = [];
  private isDragging: boolean = false;
  private activeSlider: SliderComponent | null = null;
  private pointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pointerUpHandler: (() => void) | null = null;
  
  // 特效预览
  private effectLayer!: Phaser.GameObjects.Container;
  private effectManager!: EffectManager;
  private currentEffect: EffectType | null = null;
  private effectButtons: Map<string, { bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text }> = new Map();

  constructor(scene: Phaser.Scene, screenManager: ScreenManager) {
    this.scene = scene;
    this.screenManager = screenManager;
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(100);
    this.container.setVisible(false);
    
    this.settings = this.loadSettings();
    
    this.create();
    this.setupDragHandling();
  }

  private loadSettings(): GameSettings {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('[SettingsScreen] 加载设置失败:', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      console.log('[SettingsScreen] 设置已保存');
    } catch (e) {
      console.warn('[SettingsScreen] 保存设置失败:', e);
    }
  }

  private create(): void {
    // 半透明背景遮罩
    const overlay = this.scene.add.rectangle(640, 360, 1280, 720, 0x000000, 0.85);
    overlay.setInteractive();
    this.container.add(overlay);

    // 主面板背景 - 更大以容纳特效预览
    const panel = this.scene.add.graphics();
    panel.fillStyle(0x1a1a2e, 0.98);
    panel.fillRoundedRect(140, 40, 1000, 640, 15);
    panel.lineStyle(2, 0x4a6a9a, 0.8);
    panel.strokeRoundedRect(140, 40, 1000, 640, 15);
    this.container.add(panel);

    // 标题
    const title = this.scene.add.text(640, 80, '⚙ 游戏设置', {
      fontSize: '32px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFD700',
    });
    title.setOrigin(0.5);
    this.container.add(title);

    // 左侧：音量设置
    this.createSectionTitle('🔊 音量设置', 180, 130);
    this.createSlider('主音量', 170, 'masterVolume');
    this.createSlider('背景音乐', 220, 'bgmVolume');
    this.createSlider('音效', 270, 'sfxVolume');
    
    // 左侧：游戏速度
    this.createSectionTitle('⏱️ 游戏速度', 180, 330);
    this.createSlider('文字速度', 370, 'textSpeed');
    this.createSlider('自动播放', 420, 'autoPlaySpeed');

    // 右侧：特效预览
    this.createEffectPreviewSection();

    // 底部按钮
    this.createResetButton();
    this.createBackButton();
  }

  /** 创建分区标题 */
  private createSectionTitle(text: string, x: number, y: number): void {
    const title = this.scene.add.text(x, y, text, {
      fontSize: '20px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    title.setOrigin(0, 0.5);
    this.container.add(title);
  }

  /** 创建滑块设置项 */
  private createSlider(label: string, y: number, key: keyof GameSettings): void {
    const labelX = 180;
    const sliderX = 400;
    const sliderWidth = 180;
    
    const text = this.scene.add.text(labelX, y, label, {
      fontSize: '18px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0, 0.5);
    this.container.add(text);

    const sliderBg = this.scene.add.rectangle(sliderX, y, sliderWidth, 8, 0x3a4a5a);
    sliderBg.setOrigin(0.5);
    this.container.add(sliderBg);

    const value = this.settings[key];
    const fillWidth = sliderWidth * value;
    const sliderFill = this.scene.add.rectangle(
      sliderX - sliderWidth / 2,
      y,
      fillWidth,
      8,
      0x4a9a6a
    );
    sliderFill.setOrigin(0, 0.5);
    this.container.add(sliderFill);

    const handleX = sliderX - sliderWidth / 2 + fillWidth;
    const handle = this.scene.add.circle(handleX, y, 12, 0xFFFFFF);
    handle.setStrokeStyle(2, 0x4a9a6a);
    handle.setInteractive({ useHandCursor: true });
    this.container.add(handle);

    const percent = this.scene.add.text(sliderX + sliderWidth / 2 + 20, y, `${Math.round(value * 100)}%`, {
      fontSize: '14px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#8aaaca',
    });
    percent.setOrigin(0, 0.5);
    this.container.add(percent);

    const slider: SliderComponent = {
      bg: sliderBg,
      fill: sliderFill,
      handle,
      value,
      key,
    };
    this.sliders.push(slider);

    handle.on('pointerover', () => handle.setFillStyle(0xFFD700));
    handle.on('pointerout', () => {
      if (!this.isDragging || this.activeSlider !== slider) {
        handle.setFillStyle(0xFFFFFF);
      }
    });
    handle.on('pointerdown', () => {
      this.isDragging = true;
      this.activeSlider = slider;
      handle.setFillStyle(0xFFD700);
    });

    sliderBg.setInteractive({ useHandCursor: true });
    sliderBg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const localX = pointer.x - (sliderX - sliderWidth / 2);
      const newValue = Phaser.Math.Clamp(localX / sliderWidth, 0, 1);
      this.updateSlider(slider, newValue, percent);
    });

    (slider as unknown as { percentText: Phaser.GameObjects.Text; sliderX: number; sliderWidth: number }).percentText = percent;
    (slider as unknown as { sliderX: number }).sliderX = sliderX;
    (slider as unknown as { sliderWidth: number }).sliderWidth = sliderWidth;
  }

  /** 创建特效预览区域 */
  private createEffectPreviewSection(): void {
    const sectionX = 640;
    
    // 分区标题
    this.createSectionTitle('✨ 特效预览', sectionX, 130);
    
    // 特效预览区域背景
    const previewBg = this.scene.add.graphics();
    previewBg.fillStyle(0x0a0a1a, 0.8);
    previewBg.fillRoundedRect(sectionX - 20, 150, 480, 300, 10);
    previewBg.lineStyle(1, 0x3a4a5a, 0.6);
    previewBg.strokeRoundedRect(sectionX - 20, 150, 480, 300, 10);
    this.container.add(previewBg);
    
    // 特效层
    this.effectLayer = this.scene.add.container(sectionX - 20, 150);
    // 创建遮罩（不需要显示，只用于几何遮罩）
    const mask = this.scene.add.graphics();
    mask.fillStyle(0xffffff);
    mask.fillRect(sectionX - 20, 150, 480, 300);
    mask.setVisible(false);  // 遮罩图形本身不需要显示
    this.effectLayer.setMask(mask.createGeometryMask());
    this.container.add(mask);  // 添加到 container 以便统一管理
    this.container.add(this.effectLayer);
    
    // 创建特效管理器
    this.effectManager = new EffectManager(this.scene, this.effectLayer);
    
    // 预览提示文字
    const hintText = this.scene.add.text(sectionX + 220, 300, '点击下方按钮预览特效', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#6a7a8a',
    });
    hintText.setOrigin(0.5);
    this.container.add(hintText);
    
    // 特效按钮列表
    this.createEffectButtons(sectionX);
  }

  /** 创建特效按钮列表 */
  private createEffectButtons(startX: number): void {
    const buttonY = 480;
    const buttonWidth = 62;
    const buttonHeight = 50;
    const gap = 6;
    
    const totalWidth = EFFECTS_LIST.length * buttonWidth + (EFFECTS_LIST.length - 1) * gap;
    let x = startX + (480 - totalWidth) / 2 - 20 + buttonWidth / 2;
    
    EFFECTS_LIST.forEach((effect) => {
      const btn = this.createEffectButton(x, buttonY, buttonWidth, buttonHeight, effect);
      this.container.add(btn);
      x += buttonWidth + gap;
    });
    
    // 停止按钮
    const stopBtn = this.createStopButton(startX + 220, 550);
    this.container.add(stopBtn);
  }

  /** 创建单个特效按钮 */
  private createEffectButton(
    x: number, y: number, w: number, h: number,
    effect: { type: EffectType; name: string; icon: string }
  ): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x2a3a4a, 0.9);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    btn.add(bg);
    
    const icon = this.scene.add.text(0, -8, effect.icon, {
      fontSize: '20px',
    });
    icon.setOrigin(0.5);
    btn.add(icon);
    
    const label = this.scene.add.text(0, 14, effect.name, {
      fontSize: '12px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#AAAAAA',
    });
    label.setOrigin(0.5);
    btn.add(label);
    
    const hitArea = this.scene.add.rectangle(0, 0, w, h, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);
    
    // 存储引用
    this.effectButtons.set(effect.type, { bg, text: label });
    
    hitArea.on('pointerover', () => {
      if (this.currentEffect !== effect.type) {
        bg.clear();
        bg.fillStyle(0x3a5a6a, 0.95);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
        label.setColor('#FFFFFF');
      }
    });
    
    hitArea.on('pointerout', () => {
      if (this.currentEffect !== effect.type) {
        bg.clear();
        bg.fillStyle(0x2a3a4a, 0.9);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
        label.setColor('#AAAAAA');
      }
    });
    
    hitArea.on('pointerdown', () => {
      this.playEffectPreview(effect.type, w, h);
    });
    
    return btn;
  }

  /** 创建停止按钮 */
  private createStopButton(x: number, y: number): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x5a3a3a, 0.9);
    bg.fillRoundedRect(-60, -18, 120, 36, 8);
    btn.add(bg);
    
    const text = this.scene.add.text(0, 0, '⏹ 停止特效', {
      fontSize: '14px',
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
      bg.fillStyle(0x7a4a4a, 0.95);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
      text.setColor('#FFD700');
    });
    
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x5a3a3a, 0.9);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
      text.setColor('#FFFFFF');
    });
    
    hitArea.on('pointerdown', () => {
      this.stopEffectPreview();
    });
    
    return btn;
  }

  /** 播放特效预览 */
  private playEffectPreview(effectType: EffectType, btnW: number = 62, btnH: number = 50): void {
    console.log(`[SettingsScreen] 预览特效: ${effectType}`);
    
    // 先停止当前特效
    this.effectManager.stopAll();
    
    // 更新按钮状态
    this.updateEffectButtonStates(effectType, btnW, btnH);
    
    this.currentEffect = effectType;
    
    // 播放新特效
    this.scene.time.delayedCall(100, () => {
      this.effectManager.playEffect(effectType);
    });
  }

  /** 停止特效预览 */
  private stopEffectPreview(): void {
    console.log('[SettingsScreen] 停止特效预览');
    this.effectManager.stopAll();
    this.updateEffectButtonStates(null, 62, 50);
    this.currentEffect = null;
  }

  /** 更新特效按钮状态 */
  private updateEffectButtonStates(activeType: EffectType | null, btnW: number, btnH: number): void {
    this.effectButtons.forEach((btnData, type) => {
      const { bg, text } = btnData;
      bg.clear();
      
      if (type === activeType) {
        bg.fillStyle(0x4a8a6a, 1);
        bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
        bg.lineStyle(2, 0xFFD700, 1);
        bg.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
        text.setColor('#FFD700');
      } else {
        bg.fillStyle(0x2a3a4a, 0.9);
        bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
        text.setColor('#AAAAAA');
      }
    });
  }

  private setupDragHandling(): void {
    this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.activeSlider || !this.container.visible) return;

      const slider = this.activeSlider;
      const sliderX = (slider as unknown as { sliderX: number }).sliderX || 400;
      const sliderWidth = (slider as unknown as { sliderWidth: number }).sliderWidth || 180;
      
      const localX = pointer.x - (sliderX - sliderWidth / 2);
      const newValue = Phaser.Math.Clamp(localX / sliderWidth, 0, 1);
      
      const percentText = (slider as unknown as { percentText: Phaser.GameObjects.Text }).percentText;
      this.updateSlider(slider, newValue, percentText);
    };

    this.pointerUpHandler = () => {
      if (this.isDragging && this.activeSlider) {
        this.activeSlider.handle.setFillStyle(0xFFFFFF);
        this.saveSettings();
      }
      this.isDragging = false;
      this.activeSlider = null;
    };

    this.scene.input.on('pointermove', this.pointerMoveHandler);
    this.scene.input.on('pointerup', this.pointerUpHandler);
  }

  private teardownDragHandling(): void {
    if (this.pointerMoveHandler) {
      this.scene.input.off('pointermove', this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.pointerUpHandler) {
      this.scene.input.off('pointerup', this.pointerUpHandler);
      this.pointerUpHandler = null;
    }
  }

  private updateSlider(slider: SliderComponent, value: number, percentText: Phaser.GameObjects.Text): void {
    const sliderX = (slider as unknown as { sliderX: number }).sliderX || 400;
    const sliderWidth = (slider as unknown as { sliderWidth: number }).sliderWidth || 180;
    
    slider.value = value;
    this.settings[slider.key] = value;

    const fillWidth = sliderWidth * value;
    slider.fill.setSize(fillWidth, 8);

    const handleX = sliderX - sliderWidth / 2 + fillWidth;
    slider.handle.setX(handleX);

    percentText.setText(`${Math.round(value * 100)}%`);
  }

  private createResetButton(): void {
    const btn = this.scene.add.container(380, 620);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x5a4a3a, 0.9);
    bg.fillRoundedRect(-70, -20, 140, 40, 8);
    btn.add(bg);

    const text = this.scene.add.text(0, 0, '重置默认', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0.5);
    btn.add(text);

    const hitArea = this.scene.add.rectangle(0, 0, 140, 40, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x7a6a5a, 0.95);
      bg.fillRoundedRect(-70, -20, 140, 40, 8);
      text.setColor('#FFD700');
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x5a4a3a, 0.9);
      bg.fillRoundedRect(-70, -20, 140, 40, 8);
      text.setColor('#FFFFFF');
    });

    hitArea.on('pointerdown', () => {
      console.log('[SettingsScreen] 重置为默认设置');
      this.settings = { ...DEFAULT_SETTINGS };
      this.refreshSliders();
      this.saveSettings();
    });

    this.container.add(btn);
  }

  private refreshSliders(): void {
    for (const slider of this.sliders) {
      const value = this.settings[slider.key];
      const percentText = (slider as unknown as { percentText: Phaser.GameObjects.Text }).percentText;
      this.updateSlider(slider, value, percentText);
    }
  }

  private createBackButton(): void {
    const btn = this.scene.add.container(540, 620);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x4a3a5a, 0.9);
    bg.fillRoundedRect(-70, -20, 140, 40, 8);
    btn.add(bg);

    const text = this.scene.add.text(0, 0, '← 返回', {
      fontSize: '16px',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#FFFFFF',
    });
    text.setOrigin(0.5);
    btn.add(text);

    const hitArea = this.scene.add.rectangle(0, 0, 140, 40, 0xffffff, 0);
    hitArea.setInteractive({ useHandCursor: true });
    btn.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x6a5a7a, 0.95);
      bg.fillRoundedRect(-70, -20, 140, 40, 8);
      text.setColor('#FFD700');
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x4a3a5a, 0.9);
      bg.fillRoundedRect(-70, -20, 140, 40, 8);
      text.setColor('#FFFFFF');
    });

    hitArea.on('pointerdown', () => {
      console.log('[SettingsScreen] 返回');
      this.stopEffectPreview();
      this.saveSettings();
      this.screenManager.pop();
    });

    this.container.add(btn);
  }

  show(): void {
    console.log('[SettingsScreen] 显示');
    this.settings = this.loadSettings();
    this.refreshSliders();
    
    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 200,
    });
  }

  hide(): void {
    console.log('[SettingsScreen] 隐藏');
    this.isDragging = false;
    this.activeSlider = null;
    
    // 停止特效
    this.stopEffectPreview();
    
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
    console.log('[SettingsScreen] 销毁');
    this.teardownDragHandling();
    this.effectManager.destroy();
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  static getSettings(): GameSettings {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      // ignore
    }
    return { ...DEFAULT_SETTINGS };
  }
}
