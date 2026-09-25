/**
 * 独立版游戏入口
 * 单世界视觉小说游戏
 */

import Phaser from 'phaser';
import { SimpleTitleScreen } from './screens/SimpleTitleScreen';
import { GAME_CONFIG } from './config';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  parent: 'game-container',
  width: 1280,
  height: 720,
  backgroundColor: '#0a0a1e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
  scene: [SimpleTitleScreen],
};

const game = new Phaser.Game(config);

// 导出供调试
if (GAME_CONFIG.debug) {
  (window as unknown as { game: Phaser.Game }).game = game;
}

console.log('🎮 游戏已启动');
