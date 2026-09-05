import type { BookMeta, Chapter, Mark } from '@/types/book';
import type { ReadingProgress } from '@/types/reader';
import type { ReaderSettings } from '@/types/settings';

import { STORES, openDatabase } from './schema';

export const SETTINGS_KEY = 'reader';

/** 章节主键：bookId#000012（定宽补零，保证字符串序 == 数值序） */
export function chapterKey(bookId: string, idx: number): string {
  return `${bookId}#${String(idx).padStart(6, '0')}`;
}

/** 存储层的章节数据（Chapter + 主键与外键） */
export interface StoredChapter extends Chapter {
  key: string;
  bookId: string;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(`IndexedDB 操作失败: ${String(request.error?.message)}`));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(new Error(`事务中止: ${String(tx.error?.message ?? '未知错误')}`));
    tx.onerror = () =>
      reject(new Error(`事务失败: ${String(tx.error?.message ?? '未知错误')}`));
  });
}

/**
 * IndexedDB 访问门面。
 *
 * 所有方法抛出错误时调用方必须捕获 —— 配额满、隐私模式受限等场景需要
 * 降级处理（如提示「进度不会保存」），不允许静默失败。
 */
export class EbookDb {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<EbookDb> {
    return new EbookDb(await openDatabase());
  }

  close(): void {
    this.db.close();
  }

  // ============ books ============

  async putBook(meta: BookMeta): Promise<void> {
    const tx = this.db.transaction(STORES.BOOKS, 'readwrite');
    tx.objectStore(STORES.BOOKS).put(meta);
    await transactionDone(tx);
  }

  async getBook(id: string): Promise<BookMeta | undefined> {
    const tx = this.db.transaction(STORES.BOOKS, 'readonly');
    return requestAsPromise(tx.objectStore(STORES.BOOKS).get(id));
  }

  async getAllBooks(): Promise<BookMeta[]> {
    const tx = this.db.transaction(STORES.BOOKS, 'readonly');
    const books = await requestAsPromise(
      tx.objectStore(STORES.BOOKS).getAll() as IDBRequest<BookMeta[]>,
    );
    // 最近阅读优先；从未读过的按添加时间倒序排在后面
    return books.sort(
      (a, b) => b.lastReadAt - a.lastReadAt || b.addedAt - a.addedAt,
    );
  }

  /**
   * 级联删除书籍及其章节、进度、标记。
   * 单事务保证原子性 —— 不会出现删了书却残留章节的脏数据。
   */
  async deleteBook(id: string): Promise<void> {
    const tx = this.db.transaction(
      [STORES.BOOKS, STORES.CHAPTERS, STORES.PROGRESS, STORES.MARKS],
      'readwrite',
    );

    tx.objectStore(STORES.BOOKS).delete(id);

    const chapterStore = tx.objectStore(STORES.CHAPTERS);
    const chapterRequest = chapterStore
      .index('byBook')
      .openKeyCursor(IDBKeyRange.only(id));
    chapterRequest.onsuccess = () => {
      const cursor = chapterRequest.result;
      if (cursor !== null) {
        chapterStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    tx.objectStore(STORES.PROGRESS).delete(id);

    const markStore = tx.objectStore(STORES.MARKS);
    const markRequest = markStore
      .index('byBook')
      .openKeyCursor(IDBKeyRange.only(id));
    markRequest.onsuccess = () => {
      const cursor = markRequest.result;
      if (cursor !== null) {
        markStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    await transactionDone(tx);
  }

  // ============ chapters ============

  async putChapters(
    bookId: string,
    chapters: readonly Chapter[],
  ): Promise<void> {
    const tx = this.db.transaction(STORES.CHAPTERS, 'readwrite');
    const store = tx.objectStore(STORES.CHAPTERS);
    for (const chapter of chapters) {
      const stored: StoredChapter = {
        ...chapter,
        key: chapterKey(bookId, chapter.idx),
        bookId,
      };
      store.put(stored);
    }
    await transactionDone(tx);
  }

  async getChapters(bookId: string): Promise<Chapter[]> {
    const tx = this.db.transaction(STORES.CHAPTERS, 'readonly');
    const stored = await requestAsPromise(
      tx.objectStore(STORES.CHAPTERS).index('byBook').getAll(bookId) as IDBRequest<StoredChapter[]>,
    );
    // 主键定宽补零使字符串序即数值序；仍按 idx 显式排序以防御未来迁移
    return stored
      .map(({ key: _key, bookId: _bookId, ...chapter }) => chapter)
      .sort((a, b) => a.idx - b.idx);
  }

  // ============ progress ============

  async getProgress(bookId: string): Promise<ReadingProgress | undefined> {
    const tx = this.db.transaction(STORES.PROGRESS, 'readonly');
    return requestAsPromise(tx.objectStore(STORES.PROGRESS).get(bookId));
  }

  /** 高频调用（每次翻页），单行几十字节，不触碰书库 */
  async putProgress(progress: ReadingProgress): Promise<void> {
    const tx = this.db.transaction(STORES.PROGRESS, 'readwrite');
    tx.objectStore(STORES.PROGRESS).put(progress);
    await transactionDone(tx);
  }

  // ============ settings ============

  async getSettings(): Promise<ReaderSettings | undefined> {
    const tx = this.db.transaction(STORES.SETTINGS, 'readonly');
    const row = await requestAsPromise(
      tx.objectStore(STORES.SETTINGS).get(SETTINGS_KEY) as IDBRequest<
        { key: string; value: ReaderSettings } | undefined
      >,
    );
    return row?.value;
  }

  async putSettings(settings: ReaderSettings): Promise<void> {
    const tx = this.db.transaction(STORES.SETTINGS, 'readwrite');
    tx.objectStore(STORES.SETTINGS).put({ key: SETTINGS_KEY, value: settings });
    await transactionDone(tx);
  }

  // ============ marks ============

  async putMark(mark: Mark): Promise<void> {
    const tx = this.db.transaction(STORES.MARKS, 'readwrite');
    tx.objectStore(STORES.MARKS).put(mark);
    await transactionDone(tx);
  }

  async getMarksByBook(bookId: string): Promise<Mark[]> {
    const tx = this.db.transaction(STORES.MARKS, 'readonly');
    const marks = await requestAsPromise(
      tx.objectStore(STORES.MARKS).index('byBook').getAll(bookId) as IDBRequest<Mark[]>,
    );
    return marks.sort(
      (a, b) =>
        a.anchor.chapterIdx - b.anchor.chapterIdx ||
        a.anchor.offsetInChapter - b.anchor.offsetInChapter,
    );
  }

  async deleteMark(id: string): Promise<void> {
    const tx = this.db.transaction(STORES.MARKS, 'readwrite');
    tx.objectStore(STORES.MARKS).delete(id);
    await transactionDone(tx);
  }
}
