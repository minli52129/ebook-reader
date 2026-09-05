import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { IDBFactory } from 'fake-indexeddb';

import { EbookDb } from '@/platform/db/repository';
import { importTxtFile } from '@/platform/import/import-txt';

/**
 * M1 验收测试：3 本 5MB 级 TXT 共存不崩、可正常读取。
 * 同时验证大文件章节切分不在主测试线程中超时。
 */

const TARGET_SIZE = 5 * 1024 * 1024; // 5MB

/** 生成约 targetSize 字节、章节数可控的中文小说文本 */
function makeLargeText(targetSize: number): string {
  const paragraphsPerChapter = 40;
  const paragraph = '这是一段用于填充篇幅的正文内容，用来模拟真实小说的段落长度与密度。'.repeat(2);
  // 每章体积估算：标题 + 段落数 × 单段长度
  const perChapter = 12 + paragraphsPerChapter * paragraph.length;
  const chapterCount = Math.ceil(targetSize / perChapter);

  const parts: string[] = [];
  for (let i = 1; i <= chapterCount; i++) {
    parts.push(`第${i}章 压力测试章节${i}`);
    for (let p = 0; p < paragraphsPerChapter; p++) {
      parts.push(paragraph);
    }
  }
  return parts.join('\n');
}

function makeBook(index: number): File {
  // GBK 不可编码全部字符，这里用 UTF-8（编码探测已被其他用例覆盖）
  const text = makeLargeText(TARGET_SIZE);
  return new File([text], `压力测试${index}.txt`);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('大文件导入验收（3 × 5MB）', () => {
  it('三本 5MB 级小说共存：章节数正确、全文可读、无内容丢失', { timeout: 60_000 }, async () => {
    const db = await EbookDb.open();

    const started = Date.now();
    const metas = [];
    for (let i = 1; i <= 3; i++) {
      metas.push(await importTxtFile(makeBook(i), db));
    }
    const elapsed = Date.now() - started;

    // 三本全部入库
    const books = await db.getAllBooks();
    expect(books).toHaveLength(3);
    expect(books.map((b) => b.title)).toEqual([
      '压力测试3',
      '压力测试2',
      '压力测试1',
    ]);

    for (const meta of metas) {
      // 章节切分成功且体量接近预期
      expect(meta.chapterCount).toBeGreaterThan(200);
      expect(meta.fileSize).toBeGreaterThan(4 * 1024 * 1024);

      const chapters = await db.getChapters(meta.id);
      expect(chapters).toHaveLength(meta.chapterCount);

      // 抽查首末章标题与内容完整
      expect(chapters[0].title).toBe('第1章 压力测试章节1');
      expect(chapters[0].content).toContain('填充篇幅');
      expect(chapters[chapters.length - 1].title).toContain('章');
      expect(chapters[chapters.length - 1].content.length).toBeGreaterThan(1000);

      // 全文字符总量与章节声明一致（防截断）
      const totalChars = chapters.reduce((sum, c) => sum + c.charCount, 0);
      expect(totalChars).toBeGreaterThan(4 * 1024 * 1024);
    }

    // 单本 5MB 解码+切分应在数秒级完成（宽松上限，防止退化到分钟级）
    expect(elapsed).toBeLessThan(30_000);

    db.close();
  });

  it('删除大书后级联清理全部章节', { timeout: 60_000 }, async () => {
    const db = await EbookDb.open();
    const meta = await importTxtFile(makeBook(9), db);
    expect(meta.chapterCount).toBeGreaterThan(200);

    await db.deleteBook(meta.id);

    expect(await db.getBook(meta.id)).toBeUndefined();
    expect(await db.getChapters(meta.id)).toEqual([]);
    db.close();
  });
});
