/**
 * 无限物语 V2 - 入口文件
 */

import Phaser from 'phaser';
import { TitleScreen } from './screens/TitleScreen';

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
  scene: [TitleScreen],
};

const game = new Phaser.Game(config);

// 导出供调试
(window as unknown as { game: Phaser.Game }).game = game;

console.log('🎮 无限物语 V2 已启动');
