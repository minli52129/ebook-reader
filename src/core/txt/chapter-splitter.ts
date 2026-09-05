/**
 * TXT 章节识别。
 *
 * 修复旧实现（novel-reader app.js:103）的核心缺陷：
 *   /(^|\n)\s*(第[...]+[章回节卷集部篇话]\s*[^\n]*)/g
 * 其中 `\s` 匹配含 `\n`，当标题后紧跟空行时（`第一章\n\n这是正文…`），
 * 贪婪的 `\s*` 吞掉空行，`[^\n]*` 匹配到下一行 —— 章节标题把正文第一段
 * 吞进标题，且 contentStart 计算随之错位，造成正文丢失。
 *
 * 本实现改为「逐行扫描 + 全行匹配」：
 *   - 标题只允许行内空白（[ \t\u3000]），永远不可能跨越换行 → 从根上消除该 bug
 *   - 多模式并行匹配，按命中数打分择优，兼容中英文与特殊章节名
 */

export interface SplitChapter {
  title: string;
  content: string;
}

export interface SplitResult {
  chapters: SplitChapter[];
  /** 实际采用的章节模式名；'single' 表示未识别出章节，整篇作为单章 */
  patternName: string;
}

interface ChapterPattern {
  name: string;
  /** 对「去首尾空白的单行」做全行匹配 */
  regex: RegExp;
  /**
   * 采纳该模式所需的最少命中数。
   * 弱信号模式（如纯数字前缀，极易在正文中误报）需要更高置信度。
   */
  minCount: number;
  /**
   * strong：与其他 strong 模式「并集」共存 —— 真实目录常混用
   *   （楔子 + 第N章 + 番外），择一会丢失另一模式的章节。
   * weak：仅在没有任何 strong 模式达标时才启用，
   *   避免纯数字行的正文误报污染已正确识别的目录。
   */
  strength: 'strong' | 'weak';
}

/**
 * 顺序即优先级：仅供展示与调试，实际采纳逻辑见 splitChapters。
 * 全部针对「去除首尾空白后的完整一行」匹配。
 */
const PATTERNS: readonly ChapterPattern[] = [
  {
    name: 'cn-chapter',
    // 行内空白仅允许空格/Tab/全角空格 —— 严禁 \s（它会匹配换行，正是旧 bug 根源）
    regex: /^(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷集部篇话折幕])([ \t\u3000].*)?$/u,
    minCount: 2,
    strength: 'strong',
  },
  {
    name: 'cn-special',
    regex:
      /^(楔子|序章|序言|前言|引子|尾声|后记|番外|终章|外传)([ \t\u3000].*)?$/u,
    // 楔子/番外通常全书仅出现一次，全行锚定已排除正文引用，阈值取 1
    minCount: 1,
    strength: 'strong',
  },
  {
    name: 'en-chapter',
    regex: /^((?:Chapter|CHAPTER)\s+\d+|Prologue|Epilogue)([ \t\u3000].*)?$/u,
    minCount: 2,
    strength: 'strong',
  },
  {
    name: 'cn-volume',
    regex: /^(卷\s*[0-9零一二三四五六七八九十百千]+)([ \t\u3000].*)?$/u,
    minCount: 2,
    strength: 'strong',
  },
  {
    name: 'numeric',
    // 「001 标题」「12. 标题」形式；弱信号，要求更高命中数
    regex: /^(\d{1,4})[ \t\u3000.、]+([^\s].{0,58})$/u,
    minCount: 10,
    strength: 'weak',
  },
];

/** 标题行长度上限：超过则几乎不可能是章节标题 */
const MAX_TITLE_LENGTH = 40;

/** 首个章节标题之前的引言超过此长度才独立成「序章」，否则并入第一章 */
const PRELUDE_THRESHOLD = 50;

/** 归一化：剥离 BOM、统一换行符 */
function normalize(text: string): string {
  let result = text;
  if (result.charCodeAt(0) === 0xfeff) {
    result = result.slice(1);
  }
  return result.replace(/\r\n?/g, '\n');
}

interface Candidate {
  lineIdx: number;
  title: string;
}

/** 在行数组中找出某模式的所有标题候选行 */
function findCandidates(
  lines: readonly string[],
  pattern: ChapterPattern,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0 || line.length > MAX_TITLE_LENGTH) {
      continue;
    }
    if (pattern.regex.test(line)) {
      candidates.push({ lineIdx: i, title: line });
    }
  }
  return candidates;
}

/** 组装章节：候选行之间夹的正文行归属前一个候选 */
function assembleChapters(
  lines: readonly string[],
  candidates: readonly Candidate[],
  patternName: string,
): SplitResult {
  const chapters: SplitChapter[] = [];
  const firstIdx = candidates[0].lineIdx;
  const prelude = lines
    .slice(0, firstIdx)
    .join('\n')
    .trim();

  // 首个标题之前的内容：超过阈值独立成「序章」；
  // 短引言（书名/作者行）并入第一章正文，保证内容零丢失
  let pendingPrelude: string | null = null;
  if (prelude.length > PRELUDE_THRESHOLD) {
    chapters.push({ title: '序章', content: prelude });
  } else if (prelude.length > 0) {
    pendingPrelude = prelude;
  }

  for (let i = 0; i < candidates.length; i++) {
    const start = candidates[i].lineIdx + 1;
    const end =
      i + 1 < candidates.length ? candidates[i + 1].lineIdx : lines.length;
    let content = lines
      .slice(start, end)
      .join('\n')
      .trim();

    if (i === 0 && pendingPrelude !== null) {
      content = content.length > 0 ? `${pendingPrelude}\n${content}` : pendingPrelude;
    }

    chapters.push({ title: candidates[i].title, content });
  }

  return { chapters, patternName };
}

/**
 * 将整本书文本切分为章节。
 *
 * 采纳规则：
 *   1. 所有达到各自置信度的 strong 模式候选取并集（去重、按行号排序）
 *      —— 真实目录常混用「楔子 + 第N章 + 番外」，择一会丢章节
 *   2. 若无任何 strong 模式达标，才考虑 weak 模式（numeric）
 *   3. 仍无 → 整篇作为单章返回，保证内容零丢失
 */
export function splitChapters(text: string): SplitResult {
  const lines = normalize(text).split('\n');

  const adopted: string[] = [];
  const merged: Candidate[] = [];

  for (const pattern of PATTERNS) {
    if (pattern.strength === 'weak' && adopted.length > 0) {
      continue; // 已有强模式命中，跳过弱信号
    }
    const candidates = findCandidates(lines, pattern);
    if (candidates.length < pattern.minCount) {
      continue;
    }
    if (pattern.strength === 'weak' && merged.length > 0) {
      continue; // 理论不可达（weak 仅在 merged 为空时评估），防御性保留
    }
    adopted.push(pattern.name);
    merged.push(...candidates);
  }

  if (merged.length === 0) {
    const content = lines.join('\n').trim();
    return {
      chapters: [{ title: '正文', content }],
      patternName: 'single',
    };
  }

  // 按行号去重排序（不同模式可能命中同一行）
  const seen = new Set<number>();
  const unique = merged
    .filter((c) => {
      if (seen.has(c.lineIdx)) return false;
      seen.add(c.lineIdx);
      return true;
    })
    .sort((a, b) => a.lineIdx - b.lineIdx);

  return assembleChapters(lines, unique, adopted.join('+'));
}
