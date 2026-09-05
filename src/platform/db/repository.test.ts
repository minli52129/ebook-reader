import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { BookMeta, Chapter, Mark } from '@/types/book';

import { EbookDb, chapterKey } from './repository';
import { IDBFactory } from 'fake-indexeddb';

function makeMeta(overrides: Partial<BookMeta> = {}): BookMeta {
  return {
    id: 'book-1',
    title: '测试之书',
    format: 'txt',
    fileSize: 1234,
    chapterCount: 1,
    addedAt: 1000,
    lastReadAt: 0,
    ...overrides,
  };
}

function makeChapter(idx: number, content = `第${idx}章内容`): Chapter {
  return {
    idx,
    title: `第${idx}章`,
    content,
    contentType: 'text',
    charCount: content.length,
  };
}

beforeEach(() => {
  // 每个测试独立数据库，避免相互污染
  globalThis.indexedDB = new IDBFactory();
});

describe('EbookDb', () => {
  it('books 表：写入与读取 roundtrip', async () => {
    const db = await EbookDb.open();
    await db.putBook(makeMeta());

    const loaded = await db.getBook('book-1');
    expect(loaded).toEqual(makeMeta());
    db.close();
  });

  it('getAllBooks 按 lastReadAt 倒序，未读的按 addedAt 倒序排在后面', async () => {
    const db = await EbookDb.open();
    await db.putBook(makeMeta({ id: 'a', lastReadAt: 100, addedAt: 1 }));
    await db.putBook(makeMeta({ id: 'b', lastReadAt: 300, addedAt: 2 }));
    await db.putBook(makeMeta({ id: 'c', lastReadAt: 200, addedAt: 3 }));
    await db.putBook(makeMeta({ id: 'd', lastReadAt: 0, addedAt: 50 }));
    await db.putBook(makeMeta({ id: 'e', lastReadAt: 0, addedAt: 10 }));

    const books = await db.getAllBooks();
    expect(books.map((b) => b.id)).toEqual(['b', 'c', 'a', 'd', 'e']);
    db.close();
  });

  it('chapters 表：超过 10 章时仍按数值序返回（主键定宽补零）', async () => {
    const db = await EbookDb.open();
    await db.putBook(makeMeta({ chapterCount: 12 }));
    const chapters = Array.from({ length: 12 }, (_, i) => makeChapter(i));
    await db.putChapters('book-1', chapters);

    expect(chapterKey('book-1', 2)).toBe('book-1#000002');
    expect(chapterKey('book-1', 11)).toBe('book-1#000011');

    const loaded = await db.getChapters('book-1');
    expect(loaded.map((c) => c.idx)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    // 外键与主键字段不泄漏到领域模型
    expect(loaded[0]).toEqual(makeChapter(0));
    db.close();
  });

  it('progress 表：高频写入与读取', async () => {
    const db = await EbookDb.open();
    await db.putBook(makeMeta());

    await db.putProgress({
      bookId: 'book-1',
      anchor: { chapterIdx: 2, offsetInChapter: 345 },
      percent: 0.42,
      updatedAt: 999,
    });

    const progress = await db.getProgress('book-1');
    expect(progress?.anchor).toEqual({ chapterIdx: 2, offsetInChapter: 345 });
    expect(progress?.percent).toBe(0.42);

    // 覆盖写入
    await db.putProgress({
      bookId: 'book-1',
      anchor: { chapterIdx: 3, offsetInChapter: 0 },
      percent: 0.5,
      updatedAt: 1000,
    });
    expect((await db.getProgress('book-1'))?.anchor.chapterIdx).toBe(3);
    db.close();
  });

  it('settings 表：roundtrip 与未设置时返回 undefined', async () => {
    const db = await EbookDb.open();
    expect(await db.getSettings()).toBeUndefined();

    const settings = {
      fontSize: 20,
      lineHeight: 1.6,
      fontFamily: 'sans',
      theme: 'night',
      margin: 16,
      maxWidth: 680,
      mode: 'paged',
      turnAnimation: 'slide',
    } as const;
    await db.putSettings(settings);
    expect(await db.getSettings()).toEqual(settings);
    db.close();
  });

  it('deleteBook 级联删除章节、进度与标记', async () => {
    const db = await EbookDb.open();
    await db.putBook(makeMeta());
    await db.putChapters('book-1', [makeChapter(0), makeChapter(1)]);
    await db.putProgress({
      bookId: 'book-1',
      anchor: { chapterIdx: 0, offsetInChapter: 0 },
      percent: 0,
      updatedAt: 1,
    });
    const mark: Mark = {
      id: 'm1',
      bookId: 'book-1',
      type: 'bookmark',
      anchor: { chapterIdx: 0, offsetInChapter: 5 },
      createdAt: 1,
    };
    await db.putMark(mark);

    await db.deleteBook('book-1');

    expect(await db.getBook('book-1')).toBeUndefined();
    expect(await db.getChapters('book-1')).toEqual([]);
    expect(await db.getProgress('book-1')).toBeUndefined();
    expect(await db.getMarksByBook('book-1')).toEqual([]);
    db.close();
  });

  it('deleteBook 不影响其他书籍', async () => {
    const db = await EbookDb.open();
    await db.putBook(makeMeta({ id: 'keep' }));
    await db.putChapters('keep', [makeChapter(0)]);
    await db.putBook(makeMeta({ id: 'drop' }));
    await db.putChapters('drop', [makeChapter(0)]);

    await db.deleteBook('drop');

    expect((await db.getChapters('keep'))).toHaveLength(1);
    expect(await db.getBook('keep')).toBeDefined();
    db.close();
  });

  it('marks 表：按章节与偏移排序', async () => {
    const db = await EbookDb.open();
    await db.putBook(makeMeta());
    const base = { bookId: 'book-1', type: 'bookmark' as const, createdAt: 1 };
    await db.putMark({ ...base, id: 'm3', anchor: { chapterIdx: 2, offsetInChapter: 0 } });
    await db.putMark({ ...base, id: 'm1', anchor: { chapterIdx: 0, offsetInChapter: 9 } });
    await db.putMark({ ...base, id: 'm2', anchor: { chapterIdx: 0, offsetInChapter: 1 } });

    const marks = await db.getMarksByBook('book-1');
    expect(marks.map((m) => m.id)).toEqual(['m2', 'm1', 'm3']);
    db.close();
  });
});
