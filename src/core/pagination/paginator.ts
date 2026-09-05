import type { Chapter } from '@/types/book';
import type { Page } from '@/types/reader';

import type { IMeasurer } from './measurer';

/**
 * 单章分页算法。
 *
 * 移植自 novel-reader 的分页思路（DOM 测量 + 二分查找），但做了两点关键修正：
 *   1. 测量通过 IMeasurer 接口注入 —— 算法本身零 DOM 依赖，可完整单测
 *   2. 页面记录 [startOffset, endOffset) 相对「章节规范文本」的偏移，
 *      规范文本定义为 `title + '\n' + content`，
 *      锚点恢复因此精确到字符，而不是旧实现的"分页片段长度累加"
 *      （那混入了分页时人为追加的换行，不对应源文本真实位置）
 *
 * 空间语义：Page.endOffset 为排他边界，相邻页满足
 *   pages[i].endOffset === pages[i + 1].startOffset，全文无缝覆盖。
 */

/** 章节规范文本：所有锚点偏移都以此为基准 */
export function chapterCanonicalText(chapter: Chapter): string {
  return `${chapter.title}\n${chapter.content}`;
}

export interface PaginateChapterOptions {
  chapter: Chapter;
  chapterIdx: number;
  measurer: IMeasurer;
  /** 可用排版高度（px），由视图层扣除页眉页脚边距后给出 */
  maxHeight: number;
  /** 排版缓存键，写入结果供缓存校验 */
  layoutKey: string;
  /**
   * 规范文本覆写：EPUB 章节内容为 HTML，无法按标签切片，
   * 视图层传入提取后的纯文本作为分页与锚点基准（必须与渲染口径一致）。
   * 缺省用 title + '\n' + content。
   */
  text?: string;
}

/**
 * 将单章切分为若干页。
 * 保证至少返回一页（空章也有标题页）。
 */
export function paginateChapter(options: PaginateChapterOptions): Page[] {
  const { chapter, chapterIdx, measurer, maxHeight, layoutKey, text } = options;
  const fullText = text ?? chapterCanonicalText(chapter);
  void layoutKey;

  const pages: Page[] = [];
  let start = 0;

  while (start < fullText.length) {
    // 二分查找：从 start 起最多能容纳多少字符
    const fitCount = measurer.fit('', fullText.slice(start), maxHeight);
    let end = start + Math.max(fitCount, 0);

    // 防死循环：容器高度不足一行时 fit 可能返回 0，
    // 强制推进一个字符（保留旧实现 app.js:224-231 的防护逻辑）
    if (end <= start) {
      end = start + 1;
    }

    pages.push({
      chapterIdx,
      startOffset: start,
      endOffset: end,
      fragment: fullText.slice(start, end),
    });
    start = end;
  }

  if (pages.length === 0) {
    // 空章保底一页（fullText 为空串时 while 不执行）
    pages.push({
      chapterIdx,
      startOffset: 0,
      endOffset: 0,
      fragment: '',
    });
  }

  return pages;
}

/** 查找包含指定章内偏移的页下标（用于锚点恢复） */
export function findPageByOffset(pages: readonly Page[], offset: number): number {
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // offset 落在 [start, end) 内；恰好等于末页 endOffset 时归末页
    if (offset >= page.startOffset && offset < page.endOffset) {
      return i;
    }
  }
  if (pages.length > 0 && offset >= pages[pages.length - 1].endOffset) {
    return pages.length - 1;
  }
  return 0;
}
