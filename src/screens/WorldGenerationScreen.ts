/**
 * 世界生成进度页面
 * 显示无限滑动进度条和实时日志
 */

import Phaser from "phaser";
import type { BaseScreen } from "./BaseScreen";
import type { ScreenManager } from "../core/ScreenManager";

/** 生成服务器地址 */
const API_BASE = "http://localhost:3010";

export class WorldGenerationScreen implements BaseScreen {
  readonly name = "worldGeneration";
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private screenManager: ScreenManager;

  // 世界 ID
  private worldId: string = "";

  // UI 元素
  private titleText!: Phaser.GameObjects.Text;
  private progressBarBg!: Phaser.GameObjects.Graphics;
  private progressSlider!: Phaser.GameObjects.Graphics;
  private logContainer!: Phaser.GameObjects.Container;
  private logTexts: Phaser.GameObjects.Text[] = [];
  private tipText!: Phaser.GameObjects.Text;

  // 状态
  private isCompleted: boolean = false;
  private pollTimer?: Phaser.Time.TimerEvent;
  private sliderX: number = 0;
  private sliderDirection: number = 1;

  // 动画粒子
  private particles: Phaser.GameObjects.Arc[] = [];

  constructor(scene: Phaser.Scene, screenManager: ScreenManager) {
    this.scene = scene;
    this.screenManager = screenManager;
    this.container = scene.add.container(0, 0);
    this.container.setVisible(false);
    this.createUI();
  }

  private createUI(): void {
    const centerX = 640;

    // 背景
    const bg = this.scene.add.rectangle(640, 360, 1280, 720, 0x0a1520, 1);
    this.container.add(bg);

    // 添加动态背景粒子
    this.createBackgroundParticles();

    // 标题
    this.titleText = this.scene.add.text(centerX, 100, "✨ 正在创造新世界...", {
      fontSize: "36px",
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: "#FFD700",
      fontStyle: "bold",
    });
    this.titleText.setOrigin(0.5);
    this.container.add(this.titleText);

    // 进度条背景
    const barWidth = 600;
    const barHeight = 16;
    const barX = centerX - barWidth / 2;
    const barY = 180;

    this.progressBarBg = this.scene.add.graphics();
    this.progressBarBg.fillStyle(0x1a2a3a, 1);
    this.progressBarBg.fillRoundedRect(barX, barY, barWidth, barHeight, 8);
    this.progressBarBg.lineStyle(1, 0x3a5a7a, 1);
    this.progressBarBg.strokeRoundedRect(barX, barY, barWidth, barHeight, 8);
    this.container.add(this.progressBarBg);

    // 滑动块
    this.progressSlider = this.scene.add.graphics();
    this.container.add(this.progressSlider);

    // 日志容器
    this.createLogArea(centerX, 380);

    // 提示文本
    this.tipText = this.scene.add.text(centerX, 650, "💡 AI 正在为你创作独一无二的故事...", {
      fontSize: "14px",
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: "#6a8aaa",
    });
    this.tipText.setOrigin(0.5);
    this.container.add(this.tipText);

    // 提示文本动画
    this.scene.tweens.add({
      targets: this.tipText,
      alpha: { from: 0.5, to: 1 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
    });
  }

  /** 创建日志显示区域 */
  private createLogArea(centerX: number, y: number): void {
    this.logContainer = this.scene.add.container(centerX, y);
    this.container.add(this.logContainer);

    // 日志区域背景
    const logBg = this.scene.add.graphics();
    logBg.fillStyle(0x0d1a24, 0.95);
    logBg.fillRoundedRect(-450, -150, 900, 300, 12);
    logBg.lineStyle(1, 0x2a4a6a, 0.8);
    logBg.strokeRoundedRect(-450, -150, 900, 300, 12);
    this.logContainer.add(logBg);

    // 日志标题
    const logTitle = this.scene.add.text(-430, -135, "📋 生成日志", {
      fontSize: "14px",
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: "#6a8aaa",
    });
    this.logContainer.add(logTitle);

    // 创建日志行（显示 10 行）
    for (let i = 0; i < 10; i++) {
      const logLine = this.scene.add.text(-430, -100 + i * 26, "", {
        fontSize: "13px",
        fontFamily: '"Consolas", "Monaco", monospace',
        color: "#8aaaca",
        wordWrap: { width: 860 },
      });
      this.logTexts.push(logLine);
      this.logContainer.add(logLine);
    }
  }

  /** 创建背景粒子 */
  private createBackgroundParticles(): void {
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * 1280;
      const y = Math.random() * 720;
      const size = Math.random() * 2 + 1;
      const alpha = Math.random() * 0.2 + 0.1;

      const particle = this.scene.add.circle(x, y, size, 0x4a8aca, alpha);
      this.particles.push(particle);
      this.container.add(particle);

      // 随机漂浮动画
      this.scene.tweens.add({
        targets: particle,
        y: y - 30 - Math.random() * 30,
        alpha: 0,
        duration: 4000 + Math.random() * 3000,
        repeat: -1,
        onRepeat: () => {
          particle.setPosition(Math.random() * 1280, 720 + 10);
          particle.setAlpha(alpha);
        },
      });
    }
  }

  /** 更新滑动进度条 */
  private updateSlider(): void {
    if (this.isCompleted) return;

    const barWidth = 600;
    const barX = 640 - barWidth / 2;
    const barY = 180;
    const sliderWidth = 120;

    // 滑块来回移动
    this.sliderX += this.sliderDirection * 4;
    if (this.sliderX > barWidth - sliderWidth) {
      this.sliderX = barWidth - sliderWidth;
      this.sliderDirection = -1;
    } else if (this.sliderX < 0) {
      this.sliderX = 0;
      this.sliderDirection = 1;
    }

    this.progressSlider.clear();

    // 绘制滑块（渐变效果）
    const gradient = 0x4a9aca;
    this.progressSlider.fillStyle(gradient, 0.9);
    this.progressSlider.fillRoundedRect(barX + this.sliderX, barY + 2, sliderWidth, 12, 6);

    // 高光
    this.progressSlider.fillStyle(0xffffff, 0.3);
    this.progressSlider.fillRoundedRect(barX + this.sliderX + 4, barY + 3, sliderWidth - 8, 4, 2);
  }

  /** 轮询状态 */
  private async pollStatus(): Promise<void> {
    if (this.isCompleted || !this.worldId) return;

    try {
      const statusRes = await fetch(`${API_BASE}/api/generation-status/${this.worldId}`);
      if (statusRes.ok) {
        const status = await statusRes.json();

        // 更新日志显示
        if (status.recentLogs && status.recentLogs.length > 0) {
          this.updateLogs(status.recentLogs);
        }

        if (status.status === "completed") {
          this.onGenerationComplete();
          return;
        } else if (status.status === "failed") {
          this.onGenerationFailed(status.error);
          return;
        }
      }
    } catch (error) {
      console.error("[WorldGenerationScreen] 轮询失败:", error);
    }
  }

  /** 更新日志显示 */
  private updateLogs(logs: string[]): void {
    // 过滤和格式化日志
    const filteredLogs = logs
      .filter((l) => l && !l.includes("npm warn") && !l.includes("ExperimentalWarning"))
      .slice(-10);

    // 更新日志行
    for (let i = 0; i < this.logTexts.length; i++) {
      if (i < filteredLogs.length) {
        let log = filteredLogs[i];
        // 截断过长的行
        if (log.length > 100) {
          log = log.substring(0, 97) + "...";
        }
        // 根据内容添加颜色
        let color = "#8aaaca";
        if (log.includes("✅") || log.includes("完成") || log.includes("success")) {
          color = "#4CAF50";
        } else if (log.includes("❌") || log.includes("错误") || log.includes("error")) {
          color = "#F44336";
        } else if (log.includes("🎨") || log.includes("📝") || log.includes("🖼️")) {
          color = "#FFD700";
        }
        this.logTexts[i].setText(log);
        this.logTexts[i].setColor(color);
      } else {
        this.logTexts[i].setText("");
      }
    }
  }

  /** 生成完成 */
  private onGenerationComplete(): void {
    this.isCompleted = true;

    this.titleText.setText("🎉 新世界创建完成！");
    this.titleText.setColor("#4CAF50");

    // 进度条变绿
    this.progressSlider.clear();
    const barWidth = 600;
    const barX = 640 - barWidth / 2;
    this.progressSlider.fillStyle(0x4aaa6a, 1);
    this.progressSlider.fillRoundedRect(barX + 2, 182, barWidth - 4, 12, 6);

    this.tipText.setText("✅ 点击任意位置返回世界选择...");
    this.tipText.setColor("#4CAF50");

    // 停止轮询
    if (this.pollTimer) {
      this.pollTimer.destroy();
    }

    // 添加点击返回
    this.scene.input.once("pointerdown", () => {
      this.screenManager.popTo("worldSelection");
    });

    // 自动返回
    this.scene.time.delayedCall(8000, () => {
      if (this.container.visible) {
        this.screenManager.popTo("worldSelection");
      }
    });
  }

  /** 生成失败 */
  private onGenerationFailed(error?: string): void {
    this.isCompleted = true;

    this.titleText.setText("❌ 生成失败");
    this.titleText.setColor("#F44336");

    // 进度条变红
    this.progressSlider.clear();
    const barWidth = 600;
    const barX = 640 - barWidth / 2;
    this.progressSlider.fillStyle(0xaa4a4a, 1);
    this.progressSlider.fillRoundedRect(barX + 2, 182, barWidth - 4, 12, 6);

    this.tipText.setText(`错误: ${error || "未知错误"}\n点击任意位置返回...`);
    this.tipText.setColor("#F44336");

    // 停止轮询
    if (this.pollTimer) {
      this.pollTimer.destroy();
    }

    // 添加点击返回
    this.scene.input.once("pointerdown", () => {
      this.screenManager.pop();
    });
  }

  async show(params?: Record<string, unknown>): Promise<void> {
    console.log("[WorldGenerationScreen] 显示", params);

    this.worldId = (params?.worldId as string) || "";
    this.isCompleted = false;
    this.sliderX = 0;
    this.sliderDirection = 1;

    // 重置 UI
    this.titleText.setText("✨ 正在创造新世界...");
    this.titleText.setColor("#FFD700");
    this.tipText.setText("💡 AI 正在为你创作独一无二的故事...");
    this.tipText.setColor("#6a8aaa");

    // 清空日志
    this.logTexts.forEach((t) => t.setText(""));

    this.container.setVisible(true);

    // 开始轮询 (每 1.5 秒)
    this.pollTimer = this.scene.time.addEvent({
      delay: 1500,
      callback: () => this.pollStatus(),
      loop: true,
    });

    // 滑块动画 (每 30ms)
    this.scene.time.addEvent({
      delay: 30,
      callback: () => this.updateSlider(),
      loop: true,
    });

    // 立即轮询一次
    this.pollStatus();
  }

  async hide(): Promise<void> {
    console.log("[WorldGenerationScreen] 隐藏");

    // 停止定时器
    if (this.pollTimer) {
      this.pollTimer.destroy();
      this.pollTimer = undefined;
    }

    this.container.setVisible(false);
  }

  destroy(): void {
    this.hide();
    this.particles.forEach((p) => p.destroy());
    this.container.destroy();
  }

  isVisible(): boolean {
    return this.container.visible;
  }
}
