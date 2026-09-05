/**
 * IndexedDB schema 与版本迁移。
 *
 * 设计要点：books 只存元信息，章节正文独立存放 —— 书架列表不再拖入全文，
 * 进度写入（高频）与书库（大文本）彻底解耦，修复旧实现「翻页即序列化整个
 * 书库」且触发 localStorage 5MB 配额崩溃的问题。
 */

export const DB_NAME = 'ebook-reader';
export const DB_VERSION = 1;

export const STORES = {
  BOOKS: 'books',
  CHAPTERS: 'chapters',
  PROGRESS: 'progress',
  SETTINGS: 'settings',
  MARKS: 'marks',
} as const;

/** 打开数据库，必要时执行版本迁移 */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // 版本 1：初始 schema
      if (oldVersion < 1) {
        const books = db.createObjectStore(STORES.BOOKS, { keyPath: 'id' });
        books.createIndex('byLastReadAt', 'lastReadAt');
        books.createIndex('byAddedAt', 'addedAt');

        const chapters = db.createObjectStore(STORES.CHAPTERS, {
          keyPath: 'key',
        });
        chapters.createIndex('byBook', 'bookId');

        db.createObjectStore(STORES.PROGRESS, { keyPath: 'bookId' });

        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });

        const marks = db.createObjectStore(STORES.MARKS, { keyPath: 'id' });
        marks.createIndex('byBook', 'bookId');
        marks.createIndex('byBookType', ['bookId', 'type']);
      }
      // 未来版本迁移在此追加 if (oldVersion < 2) {...}
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(`打开 IndexedDB 失败: ${String(request.error?.message ?? '未知错误')}`),
      );
    request.onblocked = () => {
      reject(new Error('IndexedDB 被其他标签页占用，请关闭后重试'));
    };
  });
}
