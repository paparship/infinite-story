import { describe, expect, it } from 'vitest';
import { ScriptParser } from '../ScriptParser';

describe('ScriptParser', () => {
  it('keeps existing parsing capability for core script formats', () => {
    const script = [
      '【章节标题】第一章',
      '@bg bg_school',
      '@char 小明 happy left',
      '【对话】小明：「你好」',
      '【旁白】（风吹过操场）',
      '【系统】存档成功',
      '【关键选择】',
      '1. 「跟上去」（谨慎）',
      '2. 「留在原地」（稳妥）',
      '【CG】 @cg cg_ch1 "初遇"',
      '@effect sakura',
      '@shake',
      '@end_chapter',
    ].join('\n');

    const result = ScriptParser.parse(script);

    expect(result.commands.map(c => c.type)).toEqual([
      'title',
      'bg',
      'char',
      'dialogue',
      'narration',
      'system',
      'choice',
      'cg',
      'effect',
      'shake',
      'end',
    ]);

    const choice = result.commands.find(c => c.type === 'choice');
    expect(choice?.params.isRouteBranch).toBe(true);
    expect((choice?.params.options as { text: string; hint?: string }[]).length).toBe(2);
    expect((choice?.params.options as { text: string; hint?: string }[])[0]).toMatchObject({
      text: '跟上去',
      hint: '谨慎',
    });

    const cg = result.commands.find(c => c.type === 'cg');
    expect(cg?.params).toMatchObject({ id: 'cg_ch1', title: '初遇' });
  });

  it('supports compact dialogue and narration formats', () => {
    const script = ['我：「这也能解析」', '（这是简洁旁白）'].join('\n');
    const result = ScriptParser.parse(script);

    expect(result.commands.map(c => c.type)).toEqual(['dialogue', 'narration']);
    expect(result.commands[0].params).toMatchObject({ name: '我', text: '这也能解析' });
    expect(result.commands[1].params).toMatchObject({ text: '这是简洁旁白' });
  });

  it('collects parse errors for unrecognized lines without changing parsed commands', () => {
    const script = [
      '【对话】小美：「已知可解析行」',
      'THIS LINE SHOULD NOT PARSE',
      '【选项】',
      '1. 继续前进',
      '???',
    ].join('\n');

    const result = ScriptParser.parse(script);

    expect(result.commands.map(c => c.type)).toEqual(['dialogue', 'choice']);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]).toContain('Line 2');
    expect(result.errors[1]).toContain('Line 5');
  });
});
