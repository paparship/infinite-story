import { describe, expect, it, vi } from 'vitest';
import { GameCommandExecutor } from '../GameCommandExecutor';
import type { ScriptCommand } from '../ScriptParser';

function createExecutor(commands: ScriptCommand[], lineRef: { value: number }) {
  const handlers = {
    background: vi.fn(),
    character: vi.fn(),
    hide: vi.fn(),
    dialogue: vi.fn(),
    narration: vi.fn(),
    choice: vi.fn(),
    cg: vi.fn(),
    shake: vi.fn(),
    effect: vi.fn(),
    title: vi.fn(),
    end: vi.fn(),
  };
  const setWaitingForInput = vi.fn();
  const onScriptEnd = vi.fn();

  const executor = new GameCommandExecutor({
    getCurrentLine: () => lineRef.value,
    getCommands: () => commands,
    setWaitingForInput,
    advanceLine: () => {
      lineRef.value += 1;
    },
    onScriptEnd,
    handlers,
  });

  return { executor, handlers, setWaitingForInput, onScriptEnd };
}

describe('GameCommandExecutor', () => {
  it('auto-advances system and unknown commands, then stops at dialogue', () => {
    const commands = [
      { type: 'system', params: { text: 'sys1' }, line: 1 },
      { type: 'system', params: { text: 'sys2' }, line: 2 },
      { type: 'unknown' as ScriptCommand['type'], params: {}, line: 3 },
      { type: 'dialogue', params: { name: 'Alice', text: 'Hello' }, line: 4 },
    ] as ScriptCommand[];

    const lineRef = { value: 0 };
    const { executor, handlers, setWaitingForInput, onScriptEnd } = createExecutor(commands, lineRef);

    executor.executeCurrentCommand();

    expect(lineRef.value).toBe(3);
    expect(handlers.dialogue).toHaveBeenCalledTimes(1);
    expect(handlers.dialogue).toHaveBeenCalledWith('Alice', 'Hello');
    expect(setWaitingForInput).toHaveBeenCalledTimes(4);
    expect(onScriptEnd).not.toHaveBeenCalled();
  });

  it('handles long auto-advance chains without recursion overflow', () => {
    const autoAdvanceCount = 15000;
    const commands: ScriptCommand[] = [];
    for (let i = 0; i < autoAdvanceCount; i += 1) {
      commands.push({ type: 'system', params: { text: `s${i}` }, line: i + 1 });
    }
    commands.push({
      type: 'dialogue',
      params: { name: 'Bob', text: 'Reached' },
      line: autoAdvanceCount + 1,
    });

    const lineRef = { value: 0 };
    const { executor, handlers } = createExecutor(commands, lineRef);

    executor.executeCurrentCommand();

    expect(lineRef.value).toBe(autoAdvanceCount);
    expect(handlers.dialogue).toHaveBeenCalledTimes(1);
    expect(handlers.dialogue).toHaveBeenCalledWith('Bob', 'Reached');
  });

  it('calls onScriptEnd when current line exceeds command list', () => {
    const lineRef = { value: 1 };
    const { executor, onScriptEnd } = createExecutor([], lineRef);

    executor.executeCurrentCommand();

    expect(onScriptEnd).toHaveBeenCalledTimes(1);
  });
});
