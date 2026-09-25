/**
 * 界面管理器
 * 管理界面的注册、切换和生命周期
 */

import type { BaseScreen } from '../screens/BaseScreen';

export class ScreenManager {
  private screens: Map<string, BaseScreen> = new Map();
  private currentScreen: string | null = null;
  private screenStack: string[] = [];

  /** 注册界面 */
  register(screen: BaseScreen): void {
    console.log(`[ScreenManager] 注册界面: ${screen.name}`);
    this.screens.set(screen.name, screen);
  }

  /** 获取界面 */
  get(name: string): BaseScreen | undefined {
    return this.screens.get(name);
  }

  /** 切换到指定界面（替换当前界面） */
  switchTo(name: string): void {
    console.log(`[ScreenManager] 切换界面: ${this.currentScreen} -> ${name}`);
    
    // 隐藏当前界面
    if (this.currentScreen) {
      const current = this.screens.get(this.currentScreen);
      current?.hide();
    }
    
    // 显示新界面
    const next = this.screens.get(name);
    if (next) {
      next.show();
      this.currentScreen = name;
      this.screenStack = [name];
    } else {
      console.warn(`[ScreenManager] 界面不存在: ${name}`);
    }
  }

  /** 打开界面（压入栈，保留之前界面） */
  push(name: string, params?: Record<string, unknown>): void {
    console.log(`[ScreenManager] 压入界面: ${name}`, params || '');
    
    // 隐藏当前界面
    if (this.currentScreen) {
      const current = this.screens.get(this.currentScreen);
      current?.hide();
    }
    
    // 显示新界面
    const next = this.screens.get(name);
    if (next) {
      next.show(params);
      this.screenStack.push(name);
      this.currentScreen = name;
    } else {
      console.warn(`[ScreenManager] 界面不存在: ${name}`);
    }
  }

  /** 关闭当前界面（弹出栈，返回上一个界面） */
  pop(): void {
    if (this.screenStack.length <= 1) {
      console.log(`[ScreenManager] 已经是底层界面，无法返回`);
      return;
    }
    
    // 隐藏并弹出当前界面
    const currentName = this.screenStack.pop()!;
    console.log(`[ScreenManager] 弹出界面: ${currentName}`);
    const current = this.screens.get(currentName);
    current?.hide();
    
    // 显示上一个界面
    const prevName = this.screenStack[this.screenStack.length - 1];
    const prev = this.screens.get(prevName);
    if (prev) {
      prev.show();
      this.currentScreen = prevName;
      console.log(`[ScreenManager] 返回界面: ${prevName}`);
    }
  }

  /** 弹出到指定界面（清除中间的界面） */
  popTo(name: string): void {
    const targetIndex = this.screenStack.indexOf(name);
    if (targetIndex === -1) {
      console.warn(`[ScreenManager] 目标界面不在栈中: ${name}，使用 switchTo`);
      this.switchTo(name);
      return;
    }

    // 隐藏当前界面
    if (this.currentScreen) {
      const current = this.screens.get(this.currentScreen);
      current?.hide();
    }

    // 清除目标界面之后的所有界面
    this.screenStack = this.screenStack.slice(0, targetIndex + 1);
    this.currentScreen = name;

    // 显示目标界面
    const target = this.screens.get(name);
    if (target) {
      target.show();
      console.log(`[ScreenManager] 返回到界面: ${name}`);
    }
  }

  /** 获取当前界面名称 */
  getCurrentScreen(): string | null {
    return this.currentScreen;
  }
}
