import type { Chapter } from '@/types/book';

export interface SearchMatch {
  chapterIdx: number;
  /** 章节规范文本内的偏移（title + '\n' + content 口径） */
  offset: number;
  /** 匹配文本长度 */
  length: number;
  /** 匹配点前后各若干字的上下文预览 */
  before: string;
  match: string;
  after: string;
}

export interface SearchOptions {
  /** 大小写敏感（默认不敏感） */
  caseSensitive?: boolean;
  /** 每章最多命中数（默认 50） */
  maxPerChapter?: number;
  /** 上下文预览半长（默认 12 字） */
  contextRadius?: number;
  /** 总结果上限（默认 200） */
  totalLimit?: number;
}

/** 章节规范文本（与分页/锚点口径一致） */
function chapterSearchText(chapter: Chapter): string {
  if (chapter.contentType === 'html') {
    const holder = typeof document === 'undefined' ? null : document.createElement('div');
    if (holder !== null) {
      holder.innerHTML = chapter.content;
      return `${chapter.title}\n${holder.textContent ?? ''}`;
    }
    // 非 DOM 环境：剥离标签的粗提取
    return `${chapter.title}\n${chapter.content.replace(/<[^>]+>/g, '')}`;
  }
  return `${chapter.title}\n${chapter.content}`;
}

/**
 * 跨章节全文搜索（纯函数，可在 Web Worker 中运行）。
 * 返回命中点及其在章节规范文本中的偏移，供阅读器定位。
 */
export function searchInChapters(
  chapters: readonly Chapter[],
  rawQuery: string,
  options: SearchOptions = {},
): SearchMatch[] {
  const query = options.caseSensitive === true ? rawQuery : rawQuery.toLowerCase();
  if (query.trim() === '') return [];

  const maxPerChapter = options.maxPerChapter ?? 50;
  const radius = options.contextRadius ?? 12;
  const totalLimit = options.totalLimit ?? 200;

  const matches: SearchMatch[] = [];
  for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
    if (matches.length >= totalLimit) break;
    const text = chapterSearchText(chapters[chapterIdx]);
    const haystack = options.caseSensitive === true ? text : text.toLowerCase();

    let fromIndex = 0;
    let chapterCount = 0;
    while (chapterCount < maxPerChapter) {
      const found = haystack.indexOf(query, fromIndex);
      if (found === -1) break;
      const before = text.slice(Math.max(0, found - radius), found);
      const match = text.slice(found, found + query.length);
      const after = text.slice(found + query.length, found + query.length + radius);
      matches.push({ chapterIdx, offset: found, length: query.length, before, match, after });
      chapterCount += 1;
      fromIndex = found + query.length;
    }
  }
  return matches;
}
