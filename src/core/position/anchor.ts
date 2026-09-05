import type { Chapter } from '@/types/book';
import type { Page, ReadingAnchor } from '@/types/reader';

/**
 * 阅读锚点工具。
 *
 * percent 按章字符数加权（而非章节序号均分），长短章混排时进度不失真。
 * 全部为纯函数，offset 语义与 paginator 的章节规范文本一致。
 */

/** 全书字符总量（含各章标题，与规范文本口径一致：每章额外 +1 个换行） */
export function totalCharCount(chapters: readonly Chapter[]): number {
  return chapters.reduce((sum, c) => sum + c.title.length + 1 + c.content.length, 0);
}

/** 某章之前所有章节的字符量（含分隔换行） */
export function charsBeforeChapter(chapters: readonly Chapter[], chapterIdx: number): number {
  let sum = 0;
  for (let i = 0; i < chapterIdx && i < chapters.length; i++) {
    sum += chapters[i].title.length + 1 + chapters[i].content.length;
  }
  return sum;
}

/** 计算阅读进度百分比（0–1） */
export function percentForAnchor(
  chapters: readonly Chapter[],
  anchor: ReadingAnchor,
): number {
  const total = totalCharCount(chapters);
  if (total <= 0) return 0;
  const before =
    charsBeforeChapter(chapters, anchor.chapterIdx) + anchor.offsetInChapter;
  return Math.min(1, Math.max(0, before / total));
}

/** 将锚点约束在合法范围内（章号越界、负偏移、章内超长均收敛） */
export function clampAnchor(
  chapters: readonly Chapter[],
  anchor: ReadingAnchor,
): ReadingAnchor {
  if (chapters.length === 0) {
    return { chapterIdx: 0, offsetInChapter: 0 };
  }
  const chapterIdx = Math.min(Math.max(anchor.chapterIdx, 0), chapters.length - 1);
  const chapter = chapters[chapterIdx];
  const max = chapter.title.length + 1 + chapter.content.length;
  const offsetInChapter = Math.min(Math.max(anchor.offsetInChapter, 0), max);
  return { chapterIdx, offsetInChapter };
}

/** 由当前页推导演读锚点 */
export function pageToAnchor(page: Page): ReadingAnchor {
  return { chapterIdx: page.chapterIdx, offsetInChapter: page.startOffset };
}
