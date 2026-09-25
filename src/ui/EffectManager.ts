/**
 * 特效管理器 v2.0
 * 增强版粒子特效系统
 * - 专属形状纹理
 * - 旋转动画
 * - 自然飘动路径
 * - 风场效果
 */

import Phaser from 'phaser';

/** 特效类型 */
export type EffectType = 'sakura' | 'rain' | 'snow' | 'stars' | 'leaves' | 'hearts' | 'fireflies' | 'stop';

/** 风场状态 */
interface WindState {
  strength: number;
  targetStrength: number;
  changeRate: number;
}

/** 特效配置 */
interface EffectConfig {
  texture: string;
  color: number[];
  speed: { min: number; max: number };
  scale: { min: number; max: number };
  lifespan: number;
  frequency: number;
  angle: { min: number; max: number };
  alpha: { start: number; end: number };
  rotate: { min: number; max: number };
  gravityY?: number;
  windAffected: boolean;
  wobble?: { amplitude: number; frequency: number };
}

const EFFECT_CONFIG: Record<string, EffectConfig> = {
  sakura: {
    texture: 'particle_petal',
    color: [0xFFB7C5, 0xFFC0CB, 0xFFE4E1, 0xFFF0F5],
    speed: { min: 40, max: 80 },
    scale: { min: 0.4, max: 0.8 },
    lifespan: 10000,
    frequency: 80,
    angle: { min: 75, max: 105 },
    alpha: { start: 0.9, end: 0 },
    rotate: { min: -180, max: 180 },
    gravityY: 15,
    windAffected: true,
    wobble: { amplitude: 50, frequency: 0.002 },
  },
  rain: {
    texture: 'particle_raindrop',
    color: [0x87CEEB, 0xADD8E6, 0xB0E0E6],
    speed: { min: 400, max: 600 },
    scale: { min: 0.3, max: 0.6 },
    lifespan: 1500,
    frequency: 8,
    angle: { min: 88, max: 92 },
    alpha: { start: 0.7, end: 0.3 },
    rotate: { min: 0, max: 0 },
    gravityY: 200,
    windAffected: true,
  },
  snow: {
    texture: 'particle_snowflake',
    color: [0xFFFFFF, 0xF0F8FF, 0xE6F3FF],
    speed: { min: 20, max: 50 },
    scale: { min: 0.3, max: 0.7 },
    lifespan: 12000,
    frequency: 100,
    angle: { min: 85, max: 95 },
    alpha: { start: 0.95, end: 0 },
    rotate: { min: -60, max: 60 },
    gravityY: 5,
    windAffected: true,
    wobble: { amplitude: 30, frequency: 0.003 },
  },
  stars: {
    texture: 'particle_star',
    color: [0xFFD700, 0xFFFF00, 0xFFFACD, 0xFFFFE0],
    speed: { min: 0, max: 0 },
    scale: { min: 0.15, max: 0.4 },
    lifespan: 2500,
    frequency: 80,  // 降低间隔，增加数量
    angle: { min: 0, max: 360 },
    alpha: { start: 0, end: 0 },
    rotate: { min: -30, max: 30 },
    windAffected: false,
  },
  leaves: {
    texture: 'particle_leaf',
    color: [0xCD853F, 0xD2691E, 0xB8860B, 0xDAA520, 0x8B4513],
    speed: { min: 30, max: 70 },
    scale: { min: 0.5, max: 0.9 },
    lifespan: 8000,
    frequency: 120,
    angle: { min: 60, max: 120 },
    alpha: { start: 0.9, end: 0 },
    rotate: { min: -200, max: 200 },
    gravityY: 20,
    windAffected: true,
    wobble: { amplitude: 60, frequency: 0.0015 },
  },
  hearts: {
    texture: 'particle_heart',
    color: [0xFF69B4, 0xFF1493, 0xFFB6C1, 0xFF6B81],
    speed: { min: 30, max: 60 },
    scale: { min: 0.3, max: 0.6 },
    lifespan: 5000,
    frequency: 60,  // 降低间隔，增加数量
    angle: { min: 250, max: 290 },
    alpha: { start: 0.9, end: 0 },
    rotate: { min: -20, max: 20 },
    gravityY: -30,
    windAffected: false,
    wobble: { amplitude: 20, frequency: 0.004 },
  },
  fireflies: {
    texture: 'particle_glow',
    color: [0xADFF2F, 0x7FFF00, 0xFFFF00, 0x9ACD32],
    speed: { min: 15, max: 40 },
    scale: { min: 0.3, max: 0.6 },  // 稍微放大
    lifespan: 6000,
    frequency: 50,  // 降低间隔，增加数量
    angle: { min: 0, max: 360 },
    alpha: { start: 0, end: 0 },
    rotate: { min: 0, max: 0 },
    windAffected: false,
    wobble: { amplitude: 40, frequency: 0.005 },
  },
};

export class EffectManager {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  
  private activeEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private particleTextures: string[] = [];
  
  private wind: WindState = {
    strength: 0,
    targetStrength: 0,
    changeRate: 0.001,
  };
  private windTimer?: Phaser.Time.TimerEvent;
  
  private customParticles: Map<Phaser.GameObjects.Particles.ParticleEmitter, {
    config: EffectConfig;
    startTime: number;
  }> = new Map();

  constructor(scene: Phaser.Scene, parentContainer: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.container = this.scene.add.container(0, 0);
    parentContainer.add(this.container);
    
    this.createAllTextures();
    this.startWindSimulation();
  }

  /** 创建所有粒子纹理 */
  private createAllTextures(): void {
    this.createPetalTexture();
    this.createRaindropTexture();
    this.createSnowflakeTexture();
    this.createStarTexture();
    this.createLeafTexture();
    this.createHeartTexture();
    this.createGlowTexture();
  }

  /** 樱花花瓣 - 使用椭圆近似 */
  private createPetalTexture(): void {
    if (this.scene.textures.exists('particle_petal')) return;
    
    const g = this.scene.make.graphics({ x: 0, y: 0 });
    
    // 花瓣主体 - 旋转的椭圆
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(16, 16, 20, 12);
    
    // 花瓣尖端
    g.fillTriangle(26, 16, 30, 14, 30, 18);
    
    // 花瓣纹理 - 中心线
    g.lineStyle(1, 0xeeeeee, 0.4);
    g.lineBetween(8, 16, 28, 16);
    
    g.generateTexture('particle_petal', 32, 32);
    g.destroy();
    this.particleTextures.push('particle_petal');
  }

  /** 雨滴 - 细长椭圆 */
  private createRaindropTexture(): void {
    if (this.scene.textures.exists('particle_raindrop')) return;
    
    const g = this.scene.make.graphics({ x: 0, y: 0 });
    
    g.fillStyle(0xffffff, 1);
    // 细长的雨滴形状
    g.fillEllipse(4, 12, 4, 16);
    // 顶部尖端
    g.fillTriangle(4, 2, 2, 6, 6, 6);
    
    g.generateTexture('particle_raindrop', 8, 24);
    g.destroy();
    this.particleTextures.push('particle_raindrop');
  }

  /** 雪花 - 六角星形 */
  private createSnowflakeTexture(): void {
    if (this.scene.textures.exists('particle_snowflake')) return;
    
    const g = this.scene.make.graphics({ x: 0, y: 0 });
    const cx = 16, cy = 16;
    
    g.lineStyle(2, 0xffffff, 1);
    
    // 六条主干
    for (let i = 0; i < 6; i++) {
      const angle = (i * 60) * Math.PI / 180;
      const len = 12;
      const x1 = cx + Math.cos(angle) * len;
      const y1 = cy + Math.sin(angle) * len;
      
      g.lineBetween(cx, cy, x1, y1);
      
      // 每条主干上的分支
      const branchLen = 4;
      for (let j = 1; j <= 2; j++) {
        const dist = len * j / 3;
        const bx = cx + Math.cos(angle) * dist;
        const by = cy + Math.sin(angle) * dist;
        
        const angle1 = angle + Math.PI / 4;
        const angle2 = angle - Math.PI / 4;
        
        g.lineBetween(bx, by, 
          bx + Math.cos(angle1) * branchLen, 
          by + Math.sin(angle1) * branchLen);
        g.lineBetween(bx, by, 
          bx + Math.cos(angle2) * branchLen, 
          by + Math.sin(angle2) * branchLen);
      }
    }
    
    // 中心点
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx, cy, 2);
    
    g.generateTexture('particle_snowflake', 32, 32);
    g.destroy();
    this.particleTextures.push('particle_snowflake');
  }

  /** 星星 - 四角星 */
  private createStarTexture(): void {
    if (this.scene.textures.exists('particle_star')) return;
    
    const g = this.scene.make.graphics({ x: 0, y: 0 });
    const cx = 16, cy = 16;
    
    g.fillStyle(0xffffff, 1);
    
    // 用多边形绘制四角星
    const outerR = 14;
    const innerR = 5;
    const points: number[] = [];
    
    for (let i = 0; i < 8; i++) {
      const angle = (i * 45 - 90) * Math.PI / 180;
      const r = i % 2 === 0 ? outerR : innerR;
      points.push(cx + Math.cos(angle) * r);
      points.push(cy + Math.sin(angle) * r);
    }
    
    g.fillPoints(points, true);
    
    // 发光中心
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(cx, cy, 4);
    
    g.generateTexture('particle_star', 32, 32);
    g.destroy();
    this.particleTextures.push('particle_star');
  }

  /** 落叶 - 简单椭圆形叶子 */
  private createLeafTexture(): void {
    if (this.scene.textures.exists('particle_leaf')) return;
    
    const g = this.scene.make.graphics({ x: 0, y: 0 });
    
    g.fillStyle(0xffffff, 1);
    
    // 主体 - 椭圆形叶子
    g.fillEllipse(16, 15, 22, 16);
    
    // 叶尖
    g.fillTriangle(16, 3, 12, 9, 20, 9);
    
    // 叶柄（短）
    g.fillRect(15, 24, 3, 4);
    
    // 叶脉 - 主脉
    g.lineStyle(2, 0xdddddd, 0.7);
    g.lineBetween(16, 4, 16, 22);
    
    // 侧脉
    g.lineStyle(1, 0xdddddd, 0.5);
    g.lineBetween(16, 10, 8, 12);
    g.lineBetween(16, 10, 24, 12);
    g.lineBetween(16, 15, 7, 18);
    g.lineBetween(16, 15, 25, 18);
    
    g.generateTexture('particle_leaf', 32, 32);
    g.destroy();
    this.particleTextures.push('particle_leaf');
  }

  /** 爱心 */
  private createHeartTexture(): void {
    if (this.scene.textures.exists('particle_heart')) return;
    
    const g = this.scene.make.graphics({ x: 0, y: 0 });
    
    g.fillStyle(0xffffff, 1);
    
    // 用两个圆和一个三角形组成爱心
    g.fillCircle(11, 12, 7);
    g.fillCircle(21, 12, 7);
    g.fillTriangle(5, 14, 27, 14, 16, 28);
    
    // 高光
    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(10, 10, 3);
    
    g.generateTexture('particle_heart', 32, 32);
    g.destroy();
    this.particleTextures.push('particle_heart');
  }

  /** 发光粒子（萤火虫） */
  private createGlowTexture(): void {
    if (this.scene.textures.exists('particle_glow')) return;
    
    const g = this.scene.make.graphics({ x: 0, y: 0 });
    
    // 多层发光效果
    g.fillStyle(0xffffff, 0.1);
    g.fillCircle(16, 16, 14);
    g.fillStyle(0xffffff, 0.2);
    g.fillCircle(16, 16, 10);
    g.fillStyle(0xffffff, 0.4);
    g.fillCircle(16, 16, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(16, 16, 3);
    
    g.generateTexture('particle_glow', 32, 32);
    g.destroy();
    this.particleTextures.push('particle_glow');
  }

  /** 启动风场模拟 */
  private startWindSimulation(): void {
    this.windTimer = this.scene.time.addEvent({
      delay: 3000,
      callback: () => {
        this.wind.targetStrength = Phaser.Math.FloatBetween(-0.8, 0.8);
      },
      loop: true,
    });
    
    this.scene.events.on('update', this.updateWind, this);
  }

  /** 更新风场 */
  private updateWind = (): void => {
    const diff = this.wind.targetStrength - this.wind.strength;
    this.wind.strength += diff * this.wind.changeRate * 16;
    
    this.customParticles.forEach((data, emitter) => {
      if (data.config.windAffected && emitter.active) {
        const windForce = this.wind.strength * 80;
        emitter.setParticleGravity(windForce, data.config.gravityY || 0);
      }
    });
  };

  /** 播放特效 */
  playEffect(effectType: EffectType): void {
    if (effectType === 'stop') {
      this.stopAll();
      return;
    }

    const config = EFFECT_CONFIG[effectType];
    if (!config) {
      console.warn(`[EffectManager] 未知特效类型: ${effectType}`);
      return;
    }

    console.log(`[EffectManager] 播放特效: ${effectType}`);

    if (effectType === 'stars') {
      this.createStarsEffect(config);
      return;
    }
    
    if (effectType === 'fireflies') {
      this.createFirefliesEffect(config);
      return;
    }

    const emitter = this.scene.add.particles(0, 0, config.texture, {
      x: { min: -50, max: 1330 },
      y: -30,
      speed: config.speed,
      scale: { start: config.scale.max, end: config.scale.min },
      lifespan: config.lifespan,
      frequency: config.frequency,
      angle: config.angle,
      alpha: config.alpha,
      tint: config.color,
      rotate: config.rotate,
      gravityY: config.gravityY || 0,
      blendMode: Phaser.BlendModes.NORMAL,
    });

    this.container.add(emitter);
    this.activeEmitters.push(emitter);
    this.customParticles.set(emitter, { config, startTime: Date.now() });

    if (config.wobble) {
      this.addWobbleEffect(emitter, config);
    }
  }

  /** 创建星星特效（闪烁） */
  private createStarsEffect(config: EffectConfig): void {
    const emitter = this.scene.add.particles(0, 0, config.texture, {
      x: { min: 50, max: 1230 },
      y: { min: 50, max: 670 },
      speed: 0,
      scale: config.scale,
      lifespan: config.lifespan,
      frequency: config.frequency,
      tint: config.color,
      rotate: config.rotate,
      blendMode: Phaser.BlendModes.ADD,
      alpha: {
        onEmit: () => 0,
        onUpdate: (_particle: Phaser.GameObjects.Particles.Particle, _key: string, t: number) => {
          return Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 8) * 0.8 + 0.2;
        }
      } as any,
    });

    this.container.add(emitter);
    this.activeEmitters.push(emitter);
    this.customParticles.set(emitter, { config, startTime: Date.now() });
  }

  /** 创建萤火虫特效 */
  private createFirefliesEffect(config: EffectConfig): void {
    const emitter = this.scene.add.particles(0, 0, config.texture, {
      x: { min: 50, max: 1230 },
      y: { min: 200, max: 650 },
      speed: config.speed,
      scale: config.scale,
      lifespan: config.lifespan,
      frequency: config.frequency,
      angle: { min: 0, max: 360 },
      tint: config.color,
      blendMode: Phaser.BlendModes.ADD,
      alpha: {
        onEmit: () => 0.3,
        onUpdate: (_particle: Phaser.GameObjects.Particles.Particle, _key: string, t: number) => {
          const breathe = Math.sin(t * Math.PI * 6) * 0.4 + 0.5;
          const fade = t < 0.1 ? t * 10 : (t > 0.9 ? (1 - t) * 10 : 1);
          return breathe * fade;
        }
      } as any,
    });

    this.container.add(emitter);
    this.activeEmitters.push(emitter);
    this.customParticles.set(emitter, { config, startTime: Date.now() });

    // 萤火虫随机游走
    this.scene.time.addEvent({
      delay: 100,
      callback: () => {
        if (!emitter.active) return;
        emitter.forEachAlive((particle: Phaser.GameObjects.Particles.Particle) => {
          if (Math.random() < 0.1) {
            particle.velocityX += Phaser.Math.FloatBetween(-30, 30);
            particle.velocityY += Phaser.Math.FloatBetween(-30, 30);
            const speed = Math.sqrt(particle.velocityX ** 2 + particle.velocityY ** 2);
            if (speed > 50) {
              particle.velocityX *= 50 / speed;
              particle.velocityY *= 50 / speed;
            }
          }
        }, this);
      },
      loop: true,
    });
  }

  /** 添加摇摆效果 */
  private addWobbleEffect(emitter: Phaser.GameObjects.Particles.ParticleEmitter, config: EffectConfig): void {
    if (!config.wobble) return;

    const wobble = config.wobble;
    
    this.scene.time.addEvent({
      delay: 50,
      callback: () => {
        if (!emitter.active) return;
        const time = Date.now();
        
        emitter.forEachAlive((particle: Phaser.GameObjects.Particles.Particle) => {
          const offset = Math.sin((time + particle.x * 10) * wobble.frequency) * wobble.amplitude;
          particle.velocityX = offset * 0.1 + this.wind.strength * 40;
        }, this);
      },
      loop: true,
    });
  }

  /** 停止所有特效 */
  stopAll(): void {
    console.log('[EffectManager] 停止所有特效');
    
    this.activeEmitters.forEach(emitter => {
      emitter.stop();
      this.customParticles.delete(emitter);
      this.scene.time.delayedCall(3000, () => {
        if (emitter && emitter.active !== undefined) {
          emitter.destroy();
        }
      });
    });
    
    this.activeEmitters = [];
  }

  /** 销毁 */
  destroy(): void {
    this.stopAll();
    
    if (this.windTimer) {
      this.windTimer.destroy();
    }
    
    this.scene.events.off('update', this.updateWind, this);
    
    this.particleTextures.forEach(key => {
      if (this.scene.textures.exists(key)) {
        this.scene.textures.remove(key);
      }
    });
    
    this.container.destroy();
  }
}
