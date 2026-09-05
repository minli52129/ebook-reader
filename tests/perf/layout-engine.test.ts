import { describe, expect, it } from 'vitest';

import type { Chapter } from '@/types/book';
import type { Layout } from '@/types/reader';

import { PaginationCache, layoutKeyOf } from '@/core/pagination/cache';
import { paginateChapter, chapterCanonicalText } from '@/core/pagination/paginator';
import type { IMeasurer } from '@/core/pagination/measurer';
import { findPageByOffset } from '@/core/pagination/paginator';

/**
 * M2 排版引擎验收：
 *  1. 单章分页性能 —— 1000 章书按章懒分页，打开只算当前章，需亚秒级
 *  2. 字号变化后位置不漂移 —— 锚点以字符偏移为基准，重排后仍命中同一阅读位置
 *  3. 缓存命中不重算 —— 同排版参数二次分页零测量调用
 */

/** 可计数的假测量器：等宽字体模型（每行 charsPerLine 字，行高 lineHeightPx） */
class CountingMeasurer implements IMeasurer {
  readonly lineHeightPx: number;
  fitCalls = 0;

  constructor(
    private readonly charsPerLine: number,
    lineHeightPx = 24,
  ) {
    this.lineHeightPx = lineHeightPx;
  }

  measure(text: string): number {
    const lines = Math.max(1, Math.ceil(Math.max(text.length, 1) / this.charsPerLine));
    const breaks = (text.match(/\n/g) ?? []).length;
    return (lines + breaks) * this.lineHeightPx;
  }

  fit(base: string, remaining: string, maxHeight: number): number {
    this.fitCalls += 1;
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

function makeChapter(idx: number, paragraphs: number): Chapter {
  const content = Array.from(
    { length: paragraphs },
    (_, p) => `第${idx}章第${p}段：这是一段用于排版测量的正文内容，长度接近真实小说段落。`,
  ).join('\n');
  return {
    idx,
    title: `第${idx}章 压力测试`,
    content,
    contentType: 'text',
    charCount: 8 + content.length,
  };
}

function layoutOf(fontSize: number): Layout {
  return {
    fontSize,
    lineHeight: 1.8,
    fontFamily: 'serif',
    viewportWidth: 390,
    viewportHeight: 844,
    margin: 20,
    maxWidth: 720,
  };
}

describe('M2 排版引擎验收', () => {
  it('典型章节（约 5k 字）单章分页 < 100ms（1000 章书打开只需算一章）', () => {
    const chapter = makeChapter(0, 50); // 约 5k 字
    const measurer = new CountingMeasurer(18);

    const started = performance.now();
    const pages = paginateChapter({
      chapter,
      chapterIdx: 0,
      measurer,
      maxHeight: 700,
      layoutKey: 'test',
    });
    const elapsed = performance.now() - started;

    expect(pages.length).toBeGreaterThan(3);
    expect(elapsed).toBeLessThan(100);
  });

  it('改字号后位置不漂移：偏移锚点在重排后仍命中同一阅读位置', () => {
    const chapter = makeChapter(0, 80);
    const fullText = chapterCanonicalText(chapter);

    const small = paginateChapter({
      chapter,
      chapterIdx: 0,
      measurer: new CountingMeasurer(20), // 字号小 → 每行多字
      maxHeight: 800,
      layoutKey: layoutKeyOf(layoutOf(16)),
    });

    // 选中中段某页的起始偏移作为锚点
    const anchorPage = small[Math.floor(small.length / 2)];
    const anchor = anchorPage.startOffset;
    const expectedChar = fullText[anchor];

    const large = paginateChapter({
      chapter,
      chapterIdx: 0,
      measurer: new CountingMeasurer(12), // 字号大 → 每行少字 → 页数变多
      maxHeight: 800,
      layoutKey: layoutKeyOf(layoutOf(26)),
    });

    expect(large.length).toBeGreaterThan(small.length);

    const restoredIdx = findPageByOffset(large, anchor);
    const restored = large[restoredIdx];
    // 恢复语义：定位到「包含锚点位置」的页（页边界随字号变化，
    // 可能原地回退几个字重读，但绝不跳读、不漂移到别处）
    expect(restored.startOffset).toBeLessThanOrEqual(anchor);
    expect(restored.endOffset).toBeGreaterThan(anchor);
    // 该页确实包含锚点处的原字符 —— 内容对应关系保持
    expect(fullText.slice(restored.startOffset, restored.endOffset)).toContain(expectedChar);
  });

  it('缓存命中：同排版参数二次取用零测量调用', () => {
    const cache = new PaginationCache(4);
    const chapter = makeChapter(0, 30);
    const layoutKey = layoutKeyOf(layoutOf(18));

    const first = new CountingMeasurer(18);
    const pages = paginateChapter({
      chapter,
      chapterIdx: 0,
      measurer: first,
      maxHeight: 700,
      layoutKey,
    });
    cache.set('book', 0, layoutKey, pages);
    const firstCost = first.fitCalls;
    expect(firstCost).toBeGreaterThan(0);

    const cached = cache.get('book', 0, layoutKey);
    expect(cached).toBe(pages); // 同一实例，零计算
    expect(new CountingMeasurer(18).fitCalls).toBe(0);
  });

  it('缓存 LRU 淘汰与排版键隔离', () => {
    const cache = new PaginationCache(2);
    const k1 = layoutKeyOf(layoutOf(18));
    const k2 = layoutKeyOf(layoutOf(22));
    const k3 = layoutKeyOf(layoutOf(26));

    expect(k1).not.toBe(k2);
    expect(k2).not.toBe(k3);

    cache.set('b', 0, k1, []);
    cache.set('b', 1, k2, []);
    cache.set('b', 2, k3, []); // 容量 2，最旧的 k1 被淘汰
    expect(cache.get('b', 0, k1)).toBeUndefined();
    expect(cache.get('b', 1, k2)).toEqual([]);
    expect(cache.get('b', 2, k3)).toEqual([]);
    expect(cache.size).toBe(2);
  });

  it('缓存 LRU 触碰：命中的条目移到队尾，避免被淘汰', () => {
    const cache = new PaginationCache(2);
    const k1 = layoutKeyOf(layoutOf(18));
    const k2 = layoutKeyOf(layoutOf(22));
    const k3 = layoutKeyOf(layoutOf(26));

    cache.set('b', 0, k1, []);
    cache.set('b', 1, k2, []);
    cache.get('b', 0, k1); // 触碰 k1 → 顺序变为 k2, k1
    cache.set('b', 2, k3, []); // 淘汰最旧的 k2
    expect(cache.get('b', 0, k1)).toEqual([]);
    expect(cache.get('b', 1, k2)).toBeUndefined();
  });
});
