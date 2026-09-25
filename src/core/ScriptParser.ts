/**
 * 脚本解析器
 * 将 .txt 脚本文件解析为指令对象数组
 */

/** 指令类型 */
export type CommandType =
  | 'bg'        // 背景切换
  | 'char'      // 角色显示
  | 'hide'      // 隐藏角色
  | 'cg'        // CG 显示
  | 'effect'    // 特效
  | 'shake'     // 震动
  | 'clear'     // 清除所有角色和特效
  | 'dialogue'  // 对话
  | 'narration' // 旁白
  | 'choice'    // 选项
  | 'end'       // 结束
  | 'title'     // 章节标题
  | 'system';   // 系统提示

/** 选项项 */
export interface ChoiceOption {
  index: number;
  text: string;
  hint?: string;  // 括号内的提示
  feedback?: string; // 选项即时反馈
}

/** 脚本指令 */
export interface ScriptCommand {
  type: CommandType;
  params: Record<string, unknown>;
  line: number;  // 原始行号，用于存档定位
}

/** 解析结果 */
export interface ParseResult {
  commands: ScriptCommand[];
  errors: string[];
  diagnostics: ParseDiagnostic[];
  specVersion: ParserSpecVersion;
  normalizedText: string;
}

export type ParserSpecVersion = 'v1_compat' | 'v2_strict';

export type ParseSeverity = 'error' | 'warning';

export interface ParseDiagnostic {
  severity: ParseSeverity;
  code: string;
  message: string;
  line: number;
  suggestion?: string;
}

export interface ParseOptions {
  specVersion?: ParserSpecVersion;
  normalize?: boolean;
}

/**
 * 脚本解析器类
 */
export class ScriptParser {
  /**
   * 解析脚本文本
   */
  static parse(scriptText: string, options: ParseOptions = {}): ParseResult {
    const specVersion = options.specVersion || 'v1_compat';
    const normalize = options.normalize !== false;
    const workingText = normalize ? this.normalizeScript(scriptText, specVersion) : scriptText;
    const lines = workingText.split('\n');
    const commands: ScriptCommand[] = [];
    const errors: string[] = [];
    const diagnostics: ParseDiagnostic[] = [];
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      const lineNum = i + 1;
      
      // 跳过空行和注释
      if (!line || line.startsWith('//') || line.startsWith('===')) {
        i++;
        continue;
      }
      
      // 跳过分支标记行（简化处理，不支持条件分支）
      if (line.startsWith('[若选择') || line.startsWith('[无论选择')) {
        i++;
        continue;
      }
      
      // 解析指令
      const cmd = this.parseLine(line, lineNum);
      
      if (cmd) {
        // 特殊处理：选项需要收集后续行
        if (cmd.type === 'choice') {
          const { options, nextIndex } = this.parseChoiceOptions(lines, i + 1);
          cmd.params.options = options;
          if (options.length === 0) {
            const message = `[Line ${lineNum}] 选项指令后未解析到任何选项: ${line}`;
            errors.push(message);
            diagnostics.push({
              severity: 'warning',
              code: 'EMPTY_CHOICE_OPTIONS',
              message,
              line: lineNum,
              suggestion: '在【选项】后提供至少 1 条数字选项',
            });
          }
          i = nextIndex;
          commands.push(cmd);
          continue;
        }
        
        commands.push(cmd);
      } else {
        const message = `[Line ${lineNum}] 无法解析: ${line}`;
        errors.push(message);
        diagnostics.push({
          severity: specVersion === 'v2_strict' ? 'error' : 'warning',
          code: 'UNPARSEABLE_LINE',
          message,
          line: lineNum,
          suggestion: '改为受支持的 @ 指令、【标签】或标准对话/旁白格式',
        });
      }
      
      i++;
    }

    if (specVersion === 'v2_strict') {
      diagnostics.push(...this.validateStrictV2(lines, commands));
      for (const d of diagnostics) {
        if (d.severity === 'error') {
          errors.push(`[Line ${d.line}] ${d.message}`);
        }
      }
    }
    
    console.log(`[ScriptParser] 解析完成: ${commands.length} 条指令`);
    return {
      commands,
      errors,
      diagnostics,
      specVersion,
      normalizedText: workingText,
    };
  }
  
  /**
   * 解析单行指令
   */
  private static parseLine(line: string, lineNum: number): ScriptCommand | null {
    // v2 元信息/路由标记（运行时可忽略）
    if (line.startsWith('@spec ') || line.startsWith('@world ') || line.startsWith('@route ') ||
        line.startsWith('@route_start ') || line.startsWith('@route_end ')) {
      return { type: 'system', params: { text: line }, line: lineNum };
    }

    // @bg {id}
    if (line.includes('@bg ')) {
      const match = line.match(/@bg\s+(\S+)/);
      if (match) {
        return { type: 'bg', params: { id: match[1] }, line: lineNum };
      }
    }

    // @chapter 第X章：标题
    if (line.includes('@chapter ')) {
      const match = line.match(/@chapter\s+(.+)/);
      if (match) {
        return { type: 'title', params: { title: match[1].trim(), kind: 'chapter' }, line: lineNum };
      }
    }

    // @game_title "标题"（用于脚本头信息）
    if (line.includes('@game_title')) {
      const match = line.match(/@game_title\s+"([^"]+)"/);
      if (match) {
        return { type: 'title', params: { title: match[1], kind: 'game_title' }, line: lineNum };
      }
    }
    
    // @char {name} {expression} {position}
    if (line.includes('@char ')) {
      const match = line.match(/@char\s+(\S+)\s+(\S+)\s+(\S+)/);
      if (match) {
        return {
          type: 'char',
          params: { name: match[1], expression: match[2], position: match[3] },
          line: lineNum,
        };
      }
    }
    
    // @hide {name}
    if (line.includes('@hide ')) {
      const match = line.match(/@hide\s+(\S+)/);
      if (match) {
        return { type: 'hide', params: { name: match[1] }, line: lineNum };
      }
    }
    
    // @cg {id} "标题"
    if (line.includes('@cg ')) {
      const match = line.match(/@cg\s+(\S+)(?:\s+"([^"]*)")?/);
      if (match) {
        return {
          type: 'cg',
          params: { id: match[1], title: match[2] || '' },
          line: lineNum,
        };
      }
    }
    
    // @effect {type}
    if (line.includes('@effect ')) {
      const match = line.match(/@effect\s+(\S+)/);
      if (match) {
        return { type: 'effect', params: { effectType: match[1] }, line: lineNum };
      }
    }
    
    // @shake
    if (line.includes('@shake')) {
      return { type: 'shake', params: {}, line: lineNum };
    }

    // @clear - 清除所有角色和效果
    if (line.includes('@clear')) {
      return { type: 'clear', params: {}, line: lineNum };
    }

    // @end_chapter / @end_game
    if (line.includes('@end_chapter') || line.includes('@end_game')) {
      const isGame = line.includes('@end_game');
      return { type: 'end', params: { isGame }, line: lineNum };
    }
    
    // 【章节标题】
    if (line.startsWith('【章节标题】') || line.startsWith('【第')) {
      const title = line.replace(/【章节标题】/, '').replace(/【|】/g, '').trim();
      return { type: 'title', params: { title }, line: lineNum };
    }

    if (line.startsWith('【游戏标题】')) {
      const atTitleMatch = line.match(/@game_title\s+"([^"]+)"/);
      if (atTitleMatch) {
        return { type: 'title', params: { title: atTitleMatch[1], kind: 'game_title' }, line: lineNum };
      }
      const title = line.replace(/^【游戏标题】/, '').replace(/【|】/g, '').trim();
      if (title) {
        return { type: 'title', params: { title, kind: 'game_title' }, line: lineNum };
      }
    }
    
    // 【对话】{name}：「{text}」
    if (line.startsWith('【对话】')) {
      const content = line.replace('【对话】', '').trim();
      const match = content.match(/^(.+?)[:：]「(.+)」$/);
      if (match) {
        return {
          type: 'dialogue',
          params: { name: match[1].trim(), text: match[2] },
          line: lineNum,
        };
      }
      // 可能是 我：「...」 格式
      const match2 = content.match(/^(.+?)[:：]\s*「(.+)」$/);
      if (match2) {
        return {
          type: 'dialogue',
          params: { name: match2[1].trim(), text: match2[2] },
          line: lineNum,
        };
      }
    }
    
    // 【旁白】（{text}）
    if (line.startsWith('【旁白】')) {
      const content = line.replace('【旁白】', '').trim();
      // 移除外层括号
      const text = content.replace(/^[（(]/, '').replace(/[）)]$/, '');
      return { type: 'narration', params: { text }, line: lineNum };
    }
    
    // 【系统】
    if (line.startsWith('【系统】')) {
      const content = line.replace('【系统】', '').replace(/【|】/g, '').trim();
      return { type: 'system', params: { text: content }, line: lineNum };
    }
    
    // 【关键选择】- 路线分支选项（决定路线）
    // 支持多种格式：【关键选择】、【系统】【关键选择】、包含"关键选择"的行
    if (line.includes('【关键选择】') || line.includes('【重要選択】') || line.includes('【ルート分岐】')) {
      return { type: 'choice', params: { options: [], isRouteBranch: true }, line: lineNum };
    }

    // @choice route|normal
    if (line.startsWith('@choice')) {
      const match = line.match(/@choice\s*(route|normal)?/i);
      const mode = (match?.[1] || 'normal').toLowerCase();
      return { type: 'choice', params: { options: [], isRouteBranch: mode === 'route' }, line: lineNum };
    }
    
    // 【选项】- 普通选项（不影响路线）
    if (line.startsWith('【选项】') || line.startsWith('【選項】') || line.startsWith('【選択肢】')) {
      return { type: 'choice', params: { options: [], isRouteBranch: false }, line: lineNum };
    }
    
    // 【背景】@bg ... / 【角色】@char ... / 【特效】@effect ... / 【震动】@shake / 【CG】@cg ...
    if (line.startsWith('【背景】') || line.startsWith('【角色】') || 
        line.startsWith('【特效】') || line.startsWith('【震动】') || line.startsWith('【CG】')) {
      // 提取 @ 指令部分
      const atMatch = line.match(/@\S+.*/);
      if (atMatch) {
        return this.parseLine(atMatch[0], lineNum);
      }
    }
    
    // 【章节结束】
    if (line.startsWith('【章节结束】')) {
      return { type: 'end', params: { isGame: false }, line: lineNum };
    }
    
    // === 简洁格式支持（无标签前缀）===
    
    // 直接对话格式：角色名：「...」
    const dialogueMatch = line.match(/^([^（【@]+?)[:：]\s*「(.+)」$/);
    if (dialogueMatch) {
      return {
        type: 'dialogue',
        params: { name: dialogueMatch[1].trim(), text: dialogueMatch[2] },
        line: lineNum,
      };
    }
    
    // 直接旁白格式：（...）
    if (line.startsWith('（') && line.endsWith('）')) {
      const text = line.slice(1, -1);
      // 过滤掉不应该显示的内容
      const skipPatterns = [
        /^Scene description:/i,  // 场景描述（应该在 settings 中）
        /^如果[选選][1-3]/,       // 条件分支标记
        /^If (player )?(choose|select)/i,  // 英文条件分支
      ];
      if (skipPatterns.some(pattern => pattern.test(text))) {
        console.log(`[ScriptParser] 跳过无效旁白: ${text.substring(0, 30)}...`);
        return null;
      }
      return { type: 'narration', params: { text }, line: lineNum };
    }
    
    return null;
  }

  private static validateStrictV2(lines: string[], commands: ScriptCommand[]): ParseDiagnostic[] {
    const diagnostics: ParseDiagnostic[] = [];
    const raw = lines.join('\n');
    const hasSpecV2 = /(^|\n)\s*@spec\s+v2\b/i.test(raw);
    if (!hasSpecV2) {
      diagnostics.push({
        severity: 'warning',
        code: 'MISSING_SPEC_HEADER',
        message: 'strict_v2 建议脚本头部包含 @spec v2',
        line: 1,
        suggestion: '在文件开头添加 @spec v2',
      });
    }

    const invalidEffects = commands
      .filter(c => c.type === 'effect')
      .filter(c => {
        const v = String(c.params.effectType || '');
        return !['sakura', 'rain', 'snow', 'stars', 'dust', 'leaves', 'hearts', 'light', 'fireflies', 'petals', 'stop', 'clear'].includes(v);
      });
    for (const cmd of invalidEffects) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_EFFECT',
        message: `未注册特效: ${String(cmd.params.effectType || '')}`,
        line: cmd.line,
        suggestion: '使用规范特效枚举值',
      });
    }

    const invalidCG = commands
      .filter(c => c.type === 'cg')
      .filter(c => !/^cg_ch[123](?:_[abc])?$/.test(String(c.params.id || '')));
    for (const cmd of invalidCG) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_CG_ID',
        message: `CG ID 不符合规范: ${String(cmd.params.id || '')}`,
        line: cmd.line,
        suggestion: '改为 cg_ch1 / cg_ch2_a|b|c / cg_ch3_a|b|c',
      });
    }

    return diagnostics;
  }

  static normalizeScript(scriptText: string, specVersion: ParserSpecVersion = 'v1_compat'): string {
    const lines = scriptText.split('\n');
    const normalized = lines.map((rawLine) => {
      let line = rawLine;

      // 统一全角符号到半角（仅指令上下文）
      line = line.replace(/^【背景】\s*@bg\s+/, '@bg ');
      line = line.replace(/^【角色】\s*@char\s+/, '@char ');
      line = line.replace(/^【CG】\s*@cg\s+/, '@cg ');
      line = line.replace(/^【特效】\s*@effect\s+/, '@effect ');
      line = line.replace(/^【震动】\s*@shake\s*$/, '@shake');
      line = line.replace(/^【章节结束】\s*$/, '@end_chapter');

      // 统一历史路线结束标记
      line = line.replace(/@end_route\s+([ABC])/ig, '@route_end $1');

      return line;
    });

    if (specVersion === 'v2_strict') {
      const hasSpec = normalized.some(line => /^\s*@spec\s+v2\b/i.test(line));
      if (!hasSpec) {
        normalized.unshift('@spec v2');
      }
    }

    return normalized.join('\n');
  }
  
  /**
   * 解析选项列表
   * 支持多种格式：
   * - 格式1: 1. 「文本」（提示）
   * - 格式2: 1. 文本（提示）
   * - 格式3: 1. **标题**：描述（多行，提示在下一行缩进）
   */
  private static parseChoiceOptions(
    lines: string[],
    startIndex: number
  ): { options: ChoiceOption[]; nextIndex: number } {
    const options: ChoiceOption[] = [];
    const pendingFeedback = new Map<number, string>();
    let i = startIndex;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // 跳过空行和注释
      if (!line || line.startsWith('//')) {
        i++;
        continue;
      }
      
      // 格式1: "1. 「文本」（提示）" - 带引号，单行
      const match1 = line.match(/^(\d+)\.\s*「(.+?)」(?:[（(](.+?)[）)])?/);
      if (match1) {
        const idx = parseInt(match1[1], 10);
        options.push({
          index: idx,
          text: match1[2],
          hint: match1[3],
          feedback: pendingFeedback.get(idx),
        });
        pendingFeedback.delete(idx);
        i++;
        continue;
      }
      
      // 格式3: "1. **标题**：描述" 或 "1. **标题**：「描述」" - Markdown 粗体格式
      const match3 = line.match(/^(\d+)\.\s*\*\*(.+?)\*\*[：:]\s*(.+)/);
      if (match3) {
        let text = match3[2].trim(); // 标题部分
        let description = match3[3].trim();
        // 移除引号
        description = description.replace(/^「/, '').replace(/」$/, '');
        text = `${text}：${description}`;
        
        // 检查下一行是否是缩进的提示
        let hint: string | undefined;
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          const hintMatch = nextLine.match(/^[（(](.+?)[）)]$/);
          if (hintMatch) {
            hint = hintMatch[1];
            i++; // 跳过提示行
          }
        }
        
        options.push({
          index: parseInt(match3[1], 10),
          text,
          hint,
          feedback: pendingFeedback.get(parseInt(match3[1], 10)),
        });
        pendingFeedback.delete(parseInt(match3[1], 10));
        i++;
        continue;
      }
      
      // 格式2: "1. 文本（提示）" - 不带引号，单行
      const match2 = line.match(/^(\d+)\.\s*(.+?)(?:[（(](.+?)[）)])?$/);
      if (match2) {
        const idx = parseInt(match2[1], 10);
        options.push({
          index: idx,
          text: match2[2].trim(),
          hint: match2[3],
          feedback: pendingFeedback.get(idx),
        });
        pendingFeedback.delete(idx);
        i++;
        continue;
      }

      // @feedback 1 「...」
      const feedbackMatch = line.match(/^@feedback\s+(\d+)\s+「(.+)」$/);
      if (feedbackMatch) {
        const idx = parseInt(feedbackMatch[1], 10);
        const text = feedbackMatch[2];
        const existing = options.find(o => o.index === idx);
        if (existing) {
          existing.feedback = text;
        } else {
          pendingFeedback.set(idx, text);
        }
        i++;
        continue;
      }
      
      // 如果是缩进的提示行（属于上一个选项），跳过
      if (line.match(/^[（(].+?[）)]$/)) {
        // 如果有上一个选项且没有提示，补充提示
        if (options.length > 0 && !options[options.length - 1].hint) {
          const hintMatch = line.match(/^[（(](.+?)[）)]$/);
          if (hintMatch) {
            options[options.length - 1].hint = hintMatch[1];
          }
        }
        i++;
        continue;
      }
      
      // 如果不是选项格式，停止收集
      break;
    }
    
    return { options, nextIndex: i };
  }
}
