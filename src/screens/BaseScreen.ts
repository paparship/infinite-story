/**
 * 界面基类接口
 * 所有界面都应实现此接口
 */

import Phaser from 'phaser';

export interface BaseScreen {
  /** 界面名称（用于日志） */
  readonly name: string;
  
  /** 界面容器 */
  readonly container: Phaser.GameObjects.Container;
  
  /** 显示界面 */
  show(params?: Record<string, unknown>): void;
  
  /** 隐藏界面 */
  hide(): void;
  
  /** 销毁界面 */
  destroy(): void;
  
  /** 界面是否可见 */
  isVisible(): boolean;
}
