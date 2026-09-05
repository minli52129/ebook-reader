import type { Page } from '@/types/reader';

import { buildLayoutKey } from './layout-key';
import type { Layout } from '@/types/reader';

/**
 * 单章分页缓存。
 *
 * 分页是重计算（DOM 测量 + O(log n) 二分/页），必须缓存。键 = 书 + 章 + 排版参数，
 * 因此字号/行距/视口变化天然不命中，无需主动失效；用简单 LRU 限制内存，
 * 排版参数变化时主动清空以防旧键长期滞留。
 */
export class PaginationCache {
  private readonly map = new Map<string, Page[]>();

  constructor(private readonly maxEntries = 64) {}

  private key(bookId: string, chapterIdx: number, layoutKey: string): string {
    return `${bookId}#${chapterIdx}|${layoutKey}`;
  }

  get(bookId: string, chapterIdx: number, layoutKey: string): Page[] | undefined {
    const key = this.key(bookId, chapterIdx, layoutKey);
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    // LRU 触碰：重新插入移到末尾
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(bookId: string, chapterIdx: number, layoutKey: string, pages: Page[]): void {
    const key = this.key(bookId, chapterIdx, layoutKey);
    this.map.delete(key);
    this.map.set(key, pages);

    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      this.map.delete(oldest.value);
    }
  }

  /** 排版参数变化时调用，避免旧排版键滞留内存 */
  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** 由 Layout 生成缓存键的便捷转发（视图层只依赖本模块与 layout-key 之一） */
export function layoutKeyOf(layout: Layout): string {
  return buildLayoutKey(layout);
}
