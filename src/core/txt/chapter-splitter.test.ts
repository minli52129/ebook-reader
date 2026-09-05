import { describe, expect, it } from 'vitest';

import { splitChapters } from './chapter-splitter';

/** 生成 N 个标准章节的文本 */
function makeBook(count: number, prefix = ''): string {
  const parts: string[] = [];
  for (let i = 1; i <= count; i++) {
    parts.push(`${prefix}第${i}章 章节标题${i}`);
    parts.push(`这是第${i}章的正文内容，足够长以避免被误判为标题。`);
  }
  return parts.join('\n');
}

describe('splitChapters', () => {
  it('【P0-3 回归】标题后紧跟空行时，标题不得吞掉正文第一段', () => {
    // 旧实现的 bug 场景：\s* 匹配换行，标题变成 "第一章\n\n这是正文…"
    // （需要 ≥3 章以达到 cn-chapter 置信度阈值）
    const text = [
      '第一章',
      '',
      '这是正文第一段，绝不允许出现在标题里。',
      '',
      '第二章',
      '',
      '这是正文第二段。',
      '',
      '第三章',
      '',
      '这是正文第三段。',
    ].join('\n');

    const result = splitChapters(text);

    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0].title).toBe('第一章');
    expect(result.chapters[0].title).not.toContain('正文');
    expect(result.chapters[0].content).toBe('这是正文第一段，绝不允许出现在标题里。');
    expect(result.chapters[1].title).toBe('第二章');
    expect(result.chapters[1].content).toBe('这是正文第二段。');
  });

  it('【P0-3 回归】全量内容零丢失：所有正文都应归属某个章节', () => {
    const text = makeBook(5);
    const result = splitChapters(text);

    const allContent = result.chapters.map((c) => c.content).join('\n');
    for (let i = 1; i <= 5; i++) {
      expect(allContent).toContain(`这是第${i}章的正文内容`);
    }
    // 标题里也不该混入正文
    for (const ch of result.chapters) {
      expect(ch.title).not.toContain('正文内容');
    }
  });

  it('标准「第N章 标题」多章切分', () => {
    const result = splitChapters(makeBook(4));
    expect(result.patternName).toBe('cn-chapter');
    expect(result.chapters).toHaveLength(4);
    expect(result.chapters[2].title).toBe('第3章 章节标题3');
  });

  it('标题行后无正文（相邻标题）时内容为空串而非 undefined', () => {
    const text = ['第一章', '第二章', '第三章'].join('\n');
    const result = splitChapters(text);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0].content).toBe('');
  });

  it('中文数字章节号', () => {
    const text = [
      '第一百二十三章 天地变色',
      '正文甲。',
      '第一百二十四章 峰回路转',
      '正文乙。',
      '第一百二十五章 大结局',
      '正文丙。',
    ].join('\n');
    const result = splitChapters(text);
    expect(result.patternName).toBe('cn-chapter');
    expect(result.chapters.map((c) => c.title)).toEqual([
      '第一百二十三章 天地变色',
      '第一百二十四章 峰回路转',
      '第一百二十五章 大结局',
    ]);
  });

  it('「卷」的行不应被 cn-chapter 模式误判', () => {
    const text = makeBook(3);
    // 卷X 行不含「章回节…」后缀字，不会命中
    const withVolume = `${text}\n卷一 结束`;
    const result = splitChapters(withVolume);
    expect(result.patternName).toBe('cn-chapter');
    // 卷一行是末章正文的一部分
    expect(result.chapters[result.chapters.length - 1].content).toContain('卷一');
  });

  it('识别「楔子/番外」与「第N章」混用的目录（strong 模式并集）', () => {
    const text = [
      '楔子',
      '序章之前的引子内容。',
      '第一章 开始',
      '正文。',
      '第二章 发展',
      '正文。',
      '第三章 高潮',
      '正文。',
      '番外 婚后日常',
      '番外正文。',
    ].join('\n');
    const result = splitChapters(text);
    // cn-chapter(3 hits) 与 cn-special(2 hits) 同时达标，取并集
    expect(result.patternName).toBe('cn-chapter+cn-special');
    expect(result.chapters.map((c) => c.title)).toEqual([
      '楔子',
      '第一章 开始',
      '第二章 发展',
      '第三章 高潮',
      '番外 婚后日常',
    ]);
    expect(result.chapters[0].content).toBe('序章之前的引子内容。');
    expect(result.chapters[4].content).toBe('番外正文。');
  });

  it('英文 Chapter N', () => {
    const text = [
      'Chapter 1 The Beginning',
      'Some text.',
      'Chapter 2 The Middle',
      'Some text.',
      'Chapter 3 The End',
      'Some text.',
    ].join('\n');
    const result = splitChapters(text);
    expect(result.patternName).toBe('en-chapter');
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0].title).toBe('Chapter 1 The Beginning');
  });

  it('短引言（书名/作者行）并入第一章而非丢弃', () => {
    const text = [
      '测试之书',
      '作者：张三',
      '第一章 开始',
      '正文。',
      '第二章 继续',
      '正文。',
      '第三章 结束',
      '正文。',
    ].join('\n');
    const result = splitChapters(text);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0].content).toContain('测试之书');
    expect(result.chapters[0].content).toContain('作者：张三');
    expect(result.chapters[0].content).toContain('正文。');
  });

  it('长引言独立成「序章」', () => {
    const longPrelude = '序'.repeat(80);
    const text = [
      longPrelude,
      '第一章 开始',
      '正文。',
      '第二章 继续',
      '正文。',
      '第三章 结束',
      '正文。',
    ].join('\n');
    const result = splitChapters(text);
    expect(result.chapters).toHaveLength(4);
    expect(result.chapters[0].title).toBe('序章');
    expect(result.chapters[0].content).toBe(longPrelude);
  });

  it('无章节标记时整篇作为单章，内容完整', () => {
    const text = '就是一段没有章节标记的普通文本。\n第二行。\n第三行。';
    const result = splitChapters(text);
    expect(result.patternName).toBe('single');
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('正文');
    expect(result.chapters[0].content).toBe(text);
  });

  it('CRLF 换行被归一化', () => {
    const text = makeBook(3).split('\n').join('\r\n');
    const result = splitChapters(text);
    expect(result.patternName).toBe('cn-chapter');
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0].content).not.toContain('\r');
  });

  it('BOM 被剥离，不影响首个标题识别', () => {
    const text = `\uFEFF${makeBook(3)}`;
    const result = splitChapters(text);
    expect(result.chapters[0].title).toBe('第1章 章节标题1');
  });

  it('弱信号 numeric 模式：偶发数字行不会误触发切分', () => {
    // 只有 3 个数字行，低于 numeric 的 minCount=10
    const text = [
      '第一章 开始',
      '正文。',
      '1. 第一条备注',
      '2. 第二条备注',
      '第二章 继续',
      '正文。',
      '3. 第三条备注',
      '第三章 结束',
      '正文。',
    ].join('\n');
    const result = splitChapters(text);
    expect(result.patternName).toBe('cn-chapter');
  });

  it('标题行超长时不作为章节标题（转为序章前导内容）', () => {
    const longLine = `第一章 ${'很'.repeat(60)}`;
    const text = [
      longLine,
      '正文。',
      '第二章 标题',
      '正文。',
      '第三章 标题',
      '正文。',
    ].join('\n');
    const result = splitChapters(text);
    // 超长行不成为标题；其与后续正文合计超过 PRELUDE_THRESHOLD，
    // 因此作为「序章」独立成章，内容零丢失
    expect(result.patternName).toBe('cn-chapter');
    expect(result.chapters.map((c) => c.title)).toEqual([
      '序章',
      '第二章 标题',
      '第三章 标题',
    ]);
    expect(result.chapters[0].content).toContain(longLine);
    expect(result.chapters[0].content).toContain('正文。');
    // 任何章节标题都不得包含超长行内容
    for (const chapter of result.chapters.slice(1)) {
      expect(chapter.title).not.toContain('很'.repeat(10));
    }
  });
});
