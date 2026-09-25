/**
 * 角色显示组件
 * 管理角色立绘的显示、位置和表情切换
 */

import Phaser from 'phaser';
import type { CharacterInfo } from '../types';

/** 角色位置配置 */
const POSITION_CONFIG = {
  left: { x: 280, depth: 10 },
  center: { x: 640, depth: 11 },
  right: { x: 1000, depth: 12 },
};

/** 角色显示配置 */
const CHAR_CONFIG = {
  y: 400,           // 角色 Y 坐标
  maxHeight: 550,   // 最大高度
  fadeTime: 200,    // 淡入淡出时间
};

/** 角色资源信息 */
interface CharacterAsset extends CharacterInfo {
  folder: string;
  sprites?: Record<string, string>;
}

/** 显示中的角色 */
interface DisplayedCharacter {
  name: string;
  position: 'left' | 'center' | 'right';
  expression: string;
  sprite: Phaser.GameObjects.Image;
}

export class CharacterDisplay {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  
  // 角色映射表
  private characterMap: Map<string, CharacterAsset> = new Map();
  private worldBaseUrl: string = '';
  
  // 当前显示的角色
  private displayedChars: Map<string, DisplayedCharacter> = new Map();
  
  // 已加载的纹理
  private loadedTextures: string[] = [];

  constructor(scene: Phaser.Scene, parentContainer: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.container = this.scene.add.container(0, 0);
    parentContainer.add(this.container);
  }

  /** 设置角色映射表 */
  setCharacterMap(charMap: Map<string, CharacterAsset>, worldBaseUrl: string): void {
    this.characterMap = charMap;
    this.worldBaseUrl = worldBaseUrl;
    console.log(`[CharacterDisplay] 设置角色映射: ${charMap.size} 个角色`);
  }

  /** 查找角色（支持模糊匹配：简称 -> 全名） */
  private findCharacter(name: string): { fullName: string; info: CharacterAsset } | null {
    // 1. 精确匹配
    const exact = this.characterMap.get(name);
    if (exact) {
      return { fullName: name, info: exact };
    }
    
    // 2. 模糊匹配：全名包含简称（如 "林晓音" 包含 "晓音"）
    for (const [fullName, info] of this.characterMap) {
      if (fullName.includes(name)) {
        console.log(`[CharacterDisplay] 模糊匹配: "${name}" -> "${fullName}"`);
        return { fullName, info };
      }
    }
    
    return null;
  }

  /** 显示角色 */
  showCharacter(
    name: string,
    expression: string,
    position: 'left' | 'center' | 'right',
    onComplete?: () => void
  ): void {
    const match = this.findCharacter(name);
    if (!match) {
      console.warn(`[CharacterDisplay] 未知角色: ${name}`);
      onComplete?.();
      return;
    }
    
    const charInfo = match.info;
    // 使用完整名称作为内部 key，确保一致性
    name = match.fullName;

    // 构建图片路径（优先使用 world.json 的 assets.sprites）
    const imagePath = this.getSpritePath(charInfo, expression);
    const textureKey = `char_${name}_${expression}`;

    console.log(`[CharacterDisplay] 显示角色: ${name} (${expression}) @ ${position}`);

    const displayChar = () => {
      // 检查是否已有该角色在其他位置
      const existing = this.displayedChars.get(name);
      if (existing) {
        // 如果位置相同只是表情变化，直接切换图片
        if (existing.position === position) {
          this.updateExpression(name, expression, textureKey, onComplete);
          return;
        }
        // 否则先移除旧的
        this.hideCharacter(name);
      }

      // 检查目标位置是否被其他角色占用，如果是则移动或隐藏
      this.resolvePositionConflict(position);

      // 创建新角色
      const posConfig = POSITION_CONFIG[position];
      const sprite = this.scene.add.image(posConfig.x, CHAR_CONFIG.y, textureKey);
      
      // 缩放适应
      const scale = CHAR_CONFIG.maxHeight / sprite.height;
      sprite.setScale(Math.min(scale, 1));
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(posConfig.depth);
      sprite.setAlpha(0);
      
      this.container.add(sprite);

      // 记录
      this.displayedChars.set(name, {
        name,
        position,
        expression,
        sprite,
      });

      // 淡入
      this.scene.tweens.add({
        targets: sprite,
        alpha: 1,
        duration: CHAR_CONFIG.fadeTime,
        onComplete: () => onComplete?.(),
      });
    };

    // 加载纹理
    if (this.scene.textures.exists(textureKey)) {
      displayChar();
    } else {
      this.loadedTextures.push(textureKey);
      this.scene.load.image(textureKey, imagePath);
      this.scene.load.once('complete', displayChar);
      this.scene.load.once('loaderror', () => {
        const fallbackPath = this.getSpritePath(charInfo, 'default');
        if (fallbackPath !== imagePath) {
          console.warn(`[CharacterDisplay] 表情加载失败，回退默认: ${imagePath} -> ${fallbackPath}`);
          this.scene.load.image(textureKey, fallbackPath);
          this.scene.load.once('complete', displayChar);
          this.scene.load.once('loaderror', () => {
            console.warn(`[CharacterDisplay] 默认立绘加载失败: ${fallbackPath}`);
            onComplete?.();
          });
          this.scene.load.start();
          return;
        }
        console.warn(`[CharacterDisplay] 加载失败: ${imagePath}`);
        onComplete?.();
      });
      this.scene.load.start();
    }
  }

  /** 更新角色表情（同位置） */
  private updateExpression(
    name: string,
    expression: string,
    textureKey: string,
    onComplete?: () => void
  ): void {
    const existing = this.displayedChars.get(name);
    if (!existing) {
      onComplete?.();
      return;
    }

    const loadAndSwitch = () => {
      // 淡出旧的
      const oldSprite = existing.sprite;
      this.scene.tweens.add({
        targets: oldSprite,
        alpha: 0,
        duration: CHAR_CONFIG.fadeTime / 2,
        onComplete: () => {
          oldSprite.destroy();
        },
      });

      // 创建新的
      const posConfig = POSITION_CONFIG[existing.position];
      const newSprite = this.scene.add.image(posConfig.x, CHAR_CONFIG.y, textureKey);
      const scale = CHAR_CONFIG.maxHeight / newSprite.height;
      newSprite.setScale(Math.min(scale, 1));
      newSprite.setOrigin(0.5, 0.5);
      newSprite.setDepth(posConfig.depth);
      newSprite.setAlpha(0);
      
      this.container.add(newSprite);

      // 更新记录
      existing.sprite = newSprite;
      existing.expression = expression;

      // 淡入
      this.scene.tweens.add({
        targets: newSprite,
        alpha: 1,
        duration: CHAR_CONFIG.fadeTime / 2,
        onComplete: () => onComplete?.(),
      });
    };

    if (this.scene.textures.exists(textureKey)) {
      loadAndSwitch();
    } else {
      const charInfo = this.characterMap.get(name);
      if (!charInfo) {
        onComplete?.();
        return;
      }
      
      const imagePath = this.getSpritePath(charInfo, expression);
      
      this.loadedTextures.push(textureKey);
      this.scene.load.image(textureKey, imagePath);
      this.scene.load.once('complete', loadAndSwitch);
      this.scene.load.once('loaderror', () => {
        const fallbackPath = this.getSpritePath(charInfo, 'default');
        if (fallbackPath !== imagePath) {
          console.warn(`[CharacterDisplay] 表情加载失败，回退默认: ${imagePath} -> ${fallbackPath}`);
          this.scene.load.image(textureKey, fallbackPath);
          this.scene.load.once('complete', loadAndSwitch);
          this.scene.load.once('loaderror', () => {
            console.warn(`[CharacterDisplay] 默认立绘加载失败: ${fallbackPath}`);
            onComplete?.();
          });
          this.scene.load.start();
          return;
        }
        console.warn(`[CharacterDisplay] 加载失败: ${imagePath}`);
        onComplete?.();
      });
      this.scene.load.start();
    }
  }

  /** 解决位置冲突：将占用目标位置的角色移到其他位置 */
  private resolvePositionConflict(targetPosition: 'left' | 'center' | 'right'): void {
    // 查找占用目标位置的角色
    let occupyingChar: DisplayedCharacter | null = null;
    for (const char of this.displayedChars.values()) {
      if (char.position === targetPosition) {
        occupyingChar = char;
        break;
      }
    }
    
    if (!occupyingChar) return;
    
    // 找一个空闲位置
    const positions: ('left' | 'center' | 'right')[] = ['left', 'center', 'right'];
    const occupiedPositions = new Set<string>();
    for (const char of this.displayedChars.values()) {
      occupiedPositions.add(char.position);
    }
    
    // 优先选择：如果目标是 center，则移到 left；否则移到 center
    let newPosition: 'left' | 'center' | 'right' | null = null;
    const preferredOrder = targetPosition === 'center' 
      ? ['left', 'right'] 
      : targetPosition === 'left' 
        ? ['center', 'right']
        : ['center', 'left'];
    
    for (const pos of preferredOrder) {
      if (!occupiedPositions.has(pos) || pos === targetPosition) {
        newPosition = pos as 'left' | 'center' | 'right';
        break;
      }
    }
    
    if (newPosition && newPosition !== targetPosition) {
      // 移动角色到新位置
      console.log(`[CharacterDisplay] 移动 ${occupyingChar.name} 从 ${targetPosition} 到 ${newPosition}`);
      this.moveCharacterTo(occupyingChar, newPosition);
    } else {
      // 没有空位，隐藏旧角色
      console.log(`[CharacterDisplay] 隐藏被覆盖的角色: ${occupyingChar.name}`);
      this.hideCharacter(occupyingChar.name);
    }
  }

  /** 将角色移动到新位置 */
  private moveCharacterTo(char: DisplayedCharacter, newPosition: 'left' | 'center' | 'right'): void {
    const newPosConfig = POSITION_CONFIG[newPosition];
    
    // 更新记录
    char.position = newPosition;
    
    // 动画移动
    this.scene.tweens.add({
      targets: char.sprite,
      x: newPosConfig.x,
      duration: 300,
      ease: 'Power2',
    });
    
    // 更新 depth
    char.sprite.setDepth(newPosConfig.depth);
  }

  /** 隐藏角色 */
  hideCharacter(name: string): void {
    const existing = this.displayedChars.get(name);
    if (!existing) return;

    console.log(`[CharacterDisplay] 隐藏角色: ${name}`);

    this.scene.tweens.add({
      targets: existing.sprite,
      alpha: 0,
      duration: CHAR_CONFIG.fadeTime,
      onComplete: () => {
        existing.sprite.destroy();
      },
    });

    this.displayedChars.delete(name);
  }

  /** 隐藏所有角色 */
  hideAll(): void {
    this.displayedChars.forEach((char) => {
      char.sprite.destroy();
    });
    this.displayedChars.clear();
  }

  /** 获取表情文件名 */
  private getExpressionFilename(expression: string): string {
    if (expression === 'default') {
      return 'base_sprite.png';
    }
    return `expression_${expression}.png`;
  }

  private getSpritePath(charInfo: CharacterAsset, expression: string): string {
    const sprites = charInfo.sprites;
    if (sprites) {
      const spritePath = sprites[expression] || sprites.default;
      if (spritePath) {
        return `${this.worldBaseUrl}/${spritePath}`;
      }
    }

    const filename = this.getExpressionFilename(expression);
    return `${this.worldBaseUrl}/${charInfo.folder}/nobg/${filename}`;
  }

  /** 清理资源 */
  cleanup(): void {
    this.hideAll();
    this.loadedTextures.forEach(key => {
      if (this.scene.textures.exists(key)) {
        this.scene.textures.remove(key);
      }
    });
    this.loadedTextures = [];
  }

  /** 销毁 */
  destroy(): void {
    this.cleanup();
    this.container.destroy();
  }
}
