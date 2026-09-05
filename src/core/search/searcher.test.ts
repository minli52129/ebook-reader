import { describe, expect, it } from 'vitest';

import type { Chapter } from '@/types/book';

import { searchInChapters } from './searcher';

function chapter(idx: number, content: string, contentType: 'text' | 'html' = 'text'): Chapter {
  return {
    idx,
    title: `第${idx}章`,
    content,
    contentType,
    charCount: 5 + content.length,
  };
}

const chapters: Chapter[] = [
  chapter(0, '这是一个关于修仙的故事，主角在灵溪边修炼。'),
  chapter(1, '灵溪的水清澈见底，修炼者称之为灵脉之源。'),
  chapter(2, '他离开了灵溪，踏上了新的旅程。'),
];

describe('searchInChapters', () => {
  it('跨章节命中，按章序返回', () => {
    const matches = searchInChapters(chapters, '灵溪');
    expect(matches.length).toBe(3);
    expect(matches.map((m) => m.chapterIdx)).toEqual([0, 1, 2]);
    expect(matches[0].match).toBe('灵溪');
  });

  it('返回上下文预览', () => {
    const [match] = searchInChapters(chapters, '灵溪');
    expect(match.before.length).toBeGreaterThan(0);
    expect(match.after.length).toBeGreaterThan(0);
  });

  it('大小写敏感可配置', () => {
    const cs = searchInChapters(chapters, '灵溪', { caseSensitive: true });
    expect(cs.length).toBe(3);
    const noHit = searchInChapters([chapter(0, 'ABCdef')], 'abc');
    expect(noHit.length).toBe(1);
    const csNoHit = searchInChapters([chapter(0, 'ABCdef')], 'abc', { caseSensitive: true });
    expect(csNoHit.length).toBe(0);
  });

  it('空查询与无命中', () => {
    expect(searchInChapters(chapters, '')).toEqual([]);
    expect(searchInChapters(chapters, '   ')).toEqual([]);
    expect(searchInChapters(chapters, '不存在的词')).toEqual([]);
  });

  it('命中上限与每章上限', () => {
    const text = '道'.repeat(1000);
    const matches = searchInChapters([chapter(0, text)], '道', { maxPerChapter: 10 });
    expect(matches.length).toBe(10);

    const many = Array.from({ length: 50 }, (_, i) => chapter(i, '道在屎溺'));
    expect(searchInChapters(many, '道', { totalLimit: 20 }).length).toBe(20);
  });

  it('HTML 章节剥离标签后搜索', () => {
    const html = [chapter(0, '<p>主角在<b>灵溪</b>修炼</p>', 'html')];
    const matches = searchInChapters(html, '灵溪');
    expect(matches.length).toBe(1);
    expect(matches[0].match).toBe('灵溪');
  });

  it('中文字符偏移正确（非字节偏移）', () => {
    const matches = searchInChapters(chapters, '修炼');
    // 规范文本 = "第0章\n这是一个关于修仙的故事，主角在灵溪边修炼。"
    const expectedOffset = '第0章\n这是一个关于修仙的故事，主角在灵溪边'.length;
    expect(matches[0].offset).toBe(expectedOffset);
  });
});
