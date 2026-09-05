import { describe, expect, it } from 'vitest';

import type { Chapter } from '@/types/book';
import type { Page } from '@/types/reader';

import { paginateChapter, chapterCanonicalText, findPageByOffset } from './paginator';
import type { IMeasurer } from './measurer';

/**
 * 假测量器：每行 charsPerLine 个字符，行高 lineHeightPx。
 * 语义与真实 DOM 测量一致：高度 = 行数 × 行高。
 */
class FakeMeasurer implements IMeasurer {
  readonly lineHeightPx: number;
  constructor(
    private readonly charsPerLine: number,
    lineHeightPx = 20,
  ) {
    this.lineHeightPx = lineHeightPx;
  }

  measure(text: string): number {
    const lines = Math.max(1, Math.ceil(Math.max(text.length, 1) / this.charsPerLine));
    // 换行符也占行（简化模型：\n 强制折行）
    const explicitBreaks = (text.match(/\n/g) ?? []).length;
    return (lines + explicitBreaks) * this.lineHeightPx;
  }

  fit(base: string, remaining: string, maxHeight: number): number {
    let low = 0;
    let high = remaining.length;
    let result = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.measure(base + remaining.slice(0, mid)) <= maxHeight) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }
}

function makeChapter(content: string, title = '第一章 测试'): Chapter {
  return {
    idx: 0,
    title,
    content,
    contentType: 'text',
    charCount: title.length + content.length,
  };
}

const LAYOUT_KEY = '18|1.8|serif|800|600|24|720';

describe('paginateChapter', () => {
  it('长章被切成多页，页偏移无缝衔接并完整覆盖全文', () => {
    const content = '字'.repeat(1000);
    const chapter = makeChapter(content);
    // 假设每页约 40 行 × 10 字/行
    const pages = paginateChapter({
      chapter,
      chapterIdx: 0,
      measurer: new FakeMeasurer(10),
      maxHeight: 40 * 20,
      layoutKey: LAYOUT_KEY,
    });

    expect(pages.length).toBeGreaterThan(1);
    // 首页从 0 开始
    expect(pages[0].startOffset).toBe(0);
    // 相邻页无缝：endOffset === 下一页 startOffset
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].startOffset).toBe(pages[i - 1].endOffset);
    }
    // 全文覆盖
    expect(pages[pages.length - 1].endOffset).toBe(chapterCanonicalText(chapter).length);
    // 拼接还原全文
    const joined = pages.map((p) => p.fragment).join('');
    expect(joined).toBe(chapterCanonicalText(chapter));
  });

  it('页面片段与偏移一致：fragment === 全文 slice(start, end)', () => {
    const content = Array.from({ length: 50 }, (_, i) => `第${i}段内容。`).join('\n');
    const chapter = makeChapter(content);
    const fullText = chapterCanonicalText(chapter);
    const pages = paginateChapter({
      chapter,
      chapterIdx: 0,
      measurer: new FakeMeasurer(12),
      maxHeight: 30 * 20,
      layoutKey: LAYOUT_KEY,
    });

    for (const page of pages) {
      expect(page.fragment).toBe(fullText.slice(page.startOffset, page.endOffset));
    }
  });

  it('容器高度不足一行时强制推进，不死循环', () => {
    const chapter = makeChapter('正文内容若干字');
    const pages = paginateChapter({
      chapter,
      chapterIdx: 0,
      measurer: new FakeMeasurer(10),
      maxHeight: 10, // 小于单行高 20
      layoutKey: LAYOUT_KEY,
    });

    expect(pages.length).toBe(chapterCanonicalText(chapter).length);
    // 每页恰好一个字符（强制推进）
    for (const page of pages) {
      expect(page.endOffset - page.startOffset).toBe(1);
    }
  });

  it('空章保底返回一页', () => {
    const pages = paginateChapter({
      chapter: makeChapter(''),
      chapterIdx: 3,
      measurer: new FakeMeasurer(10),
      maxHeight: 600,
      layoutKey: LAYOUT_KEY,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0].chapterIdx).toBe(3);
    expect(pages[0].fragment).toBe('第一章 测试\n');
  });

  it('短章单页放下', () => {
    const pages = paginateChapter({
      chapter: makeChapter('短正文。'),
      chapterIdx: 0,
      measurer: new FakeMeasurer(20),
      maxHeight: 600,
      layoutKey: LAYOUT_KEY,
    });

    expect(pages).toHaveLength(1);
  });

  it('chapterIdx 写入每一页', () => {
    const pages = paginateChapter({
      chapter: makeChapter('字'.repeat(500)),
      chapterIdx: 7,
      measurer: new FakeMeasurer(10),
      maxHeight: 400,
      layoutKey: LAYOUT_KEY,
    });
    expect(pages.every((p: Page) => p.chapterIdx === 7)).toBe(true);
  });
});

describe('findPageByOffset', () => {
  function buildPages(): Page[] {
    return paginateChapter({
      chapter: makeChapter('字'.repeat(300)),
      chapterIdx: 0,
      measurer: new FakeMeasurer(10),
      maxHeight: 400,
      layoutKey: LAYOUT_KEY,
    });
  }

  it('页内偏移命中所在页', () => {
    const pages = buildPages();
    const mid = pages[Math.floor(pages.length / 2)];
    expect(findPageByOffset(pages, mid.startOffset + 1)).toBe(
      pages.indexOf(mid),
    );
  });

  it('恰好等于末页 endOffset 时归末页（阅读到章末的场景）', () => {
    const pages = buildPages();
    const last = pages[pages.length - 1];
    expect(findPageByOffset(pages, last.endOffset)).toBe(pages.length - 1);
  });

  it('超出全文的偏移归末页，负偏移归首页', () => {
    const pages = buildPages();
    expect(findPageByOffset(pages, Number.MAX_SAFE_INTEGER)).toBe(pages.length - 1);
    expect(findPageByOffset(pages, -5)).toBe(0);
  });

  it('锚点往返一致：页 → 锚 → 页', () => {
    const pages = buildPages();
    for (let i = 0; i < pages.length; i++) {
      const anchor = { chapterIdx: 0, offsetInChapter: pages[i].startOffset };
      expect(findPageByOffset(pages, anchor.offsetInChapter)).toBe(i);
    }
  });
});
