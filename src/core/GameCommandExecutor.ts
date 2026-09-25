/**
 * 脚本指令执行器
 * 负责分发 ScriptCommand 到具体处理函数
 */

import type { ScriptCommand, ChoiceOption } from './ScriptParser';

export interface GameCommandHandlers {
  background: (id: string) => void;
  character: (params: Record<string, unknown>) => void;
  hide: (name: string) => void;
  dialogue: (name: string, text: string) => void;
  narration: (text: string) => void;
  choice: (options: ChoiceOption[], isRouteBranch?: boolean) => void;
  cg: (id: string, title: string) => void;
  shake: () => void;
  clear: () => void;
  effect: (effectType: string) => void;
  title: (title: string) => void;
  end: (isGame: boolean) => void;
}

export interface GameCommandExecutorOptions {
  getCurrentLine: () => number;
  getCommands: () => ScriptCommand[];
  setWaitingForInput: (value: boolean) => void;
  advanceLine: () => void;
  onScriptEnd: () => void;
  handlers: GameCommandHandlers;
}

export class GameCommandExecutor {
  private options: GameCommandExecutorOptions;

  constructor(options: GameCommandExecutorOptions) {
    this.options = options;
  }

  executeCurrentCommand(): void {
    const commands = this.options.getCommands();

    while (true) {
      const currentLine = this.options.getCurrentLine();

      if (currentLine >= commands.length) {
        console.log('[GameCommandExecutor] 脚本结束');
        this.options.onScriptEnd();
        return;
      }

      const cmd = commands[currentLine];
      console.log(`[GameCommandExecutor] 执行指令 #${currentLine}:`, cmd.type, cmd.params);

      this.options.setWaitingForInput(false);

      switch (cmd.type) {
        case 'bg':
          this.options.handlers.background(cmd.params.id as string);
          return;
        case 'char':
          this.options.handlers.character(cmd.params);
          return;
        case 'hide':
          this.options.handlers.hide(cmd.params.name as string);
          return;
        case 'dialogue':
          this.options.handlers.dialogue(cmd.params.name as string, cmd.params.text as string);
          return;
        case 'narration':
          this.options.handlers.narration(cmd.params.text as string);
          return;
        case 'choice':
          this.options.handlers.choice(cmd.params.options as ChoiceOption[], cmd.params.isRouteBranch as boolean);
          return;
        case 'cg':
          this.options.handlers.cg(cmd.params.id as string, cmd.params.title as string);
          return;
        case 'shake':
          this.options.handlers.shake();
          return;
        case 'clear':
          this.options.handlers.clear();
          return;
        case 'effect':
          this.options.handlers.effect(cmd.params.effectType as string);
          return;
        case 'title':
          this.options.handlers.title(cmd.params.title as string);
          return;
        case 'system':
          this.options.advanceLine();
          continue;
        case 'end':
          this.options.handlers.end(cmd.params.isGame as boolean);
          return;
        default:
          this.options.advanceLine();
          continue;
      }
    }
  }
}
