import { describe, expect, it } from 'vitest';

import type { Chapter } from '@/types/book';
import type { Page, ReadingAnchor } from '@/types/reader';

import {
  pageToAnchor,
  percentForAnchor,
  clampAnchor,
  totalCharCount,
  charsBeforeChapter,
} from './anchor';

function makeChapters(): Chapter[] {
  return [
    { idx: 0, title: '第一章', content: 'a'.repeat(100), contentType: 'text', charCount: 103 },
    { idx: 1, title: '第二章', content: 'b'.repeat(50), contentType: 'text', charCount: 53 },
    { idx: 2, title: '第三章', content: 'c'.repeat(850), contentType: 'text', charCount: 853 },
  ];
}

describe('anchor 工具', () => {
  const chapters = makeChapters();

  it('totalCharCount 与规范文本口径一致（每章 +1 换行）', () => {
    // 「第一章」3字: 3+1+100；「第二章」3字: 3+1+50；「第三章」3字: 3+1+850
    expect(totalCharCount(chapters)).toBe(104 + 54 + 854);
  });

  it('charsBeforeChapter 求前缀字符量', () => {
    expect(charsBeforeChapter(chapters, 0)).toBe(0);
    expect(charsBeforeChapter(chapters, 1)).toBe(104);
    expect(charsBeforeChapter(chapters, 2)).toBe(104 + 54);
    expect(charsBeforeChapter(chapters, 99)).toBe(104 + 54 + 854);
  });

  it('percentForAnchor：章首/章中/全书末', () => {
    const total = totalCharCount(chapters);
    expect(percentForAnchor(chapters, { chapterIdx: 0, offsetInChapter: 0 })).toBe(0);
    expect(
      percentForAnchor(chapters, { chapterIdx: 1, offsetInChapter: 0 }),
    ).toBeCloseTo(104 / total, 10);
    expect(
      percentForAnchor(chapters, { chapterIdx: 2, offsetInChapter: 854 }),
    ).toBe(1);
  });

  it('percentForAnchor 越界偏移收敛到 [0,1]', () => {
    expect(percentForAnchor(chapters, { chapterIdx: 0, offsetInChapter: -10 })).toBe(0);
    expect(percentForAnchor(chapters, { chapterIdx: 2, offsetInChapter: 99999 })).toBe(1);
  });

  it('clampAnchor 收敛章号与偏移', () => {
    expect(clampAnchor(chapters, { chapterIdx: -1, offsetInChapter: 5 })).toEqual({
      chapterIdx: 0,
      offsetInChapter: 5,
    });
    expect(clampAnchor(chapters, { chapterIdx: 9, offsetInChapter: 0 })).toEqual({
      chapterIdx: 2,
      offsetInChapter: 0,
    });
    expect(
      clampAnchor(chapters, { chapterIdx: 1, offsetInChapter: 999 }),
    ).toEqual({ chapterIdx: 1, offsetInChapter: 54 });
  });

  it('clampAnchor 空书返回原点', () => {
    expect(clampAnchor([], { chapterIdx: 3, offsetInChapter: 3 })).toEqual({
      chapterIdx: 0,
      offsetInChapter: 0,
    });
  });

  it('pageToAnchor 取页起始偏移', () => {
    const page: Page = {
      chapterIdx: 2,
      startOffset: 120,
      endOffset: 240,
      fragment: '',
    };
    expect(pageToAnchor(page)).toEqual({ chapterIdx: 2, offsetInChapter: 120 });
  });

  it('百分比与「页偏移 + 章前缀」口径自洽', () => {
    // 第 2 章内 offset=100 处的百分比 === (105+54+100)/total
    const anchor: ReadingAnchor = { chapterIdx: 2, offsetInChapter: 100 };
    expect(percentForAnchor(chapters, anchor)).toBeCloseTo(
      (charsBeforeChapter(chapters, 2) + 100) / totalCharCount(chapters),
      10,
    );
  });
});
