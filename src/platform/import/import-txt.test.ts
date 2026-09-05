import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { IDBFactory } from 'fake-indexeddb';

import { EbookDb } from '@/platform/db/repository';

import { bookTitleFromFilename, importTxtFile } from './import-txt';

/** GBK 编码的三章小说（字节映射已用 Node TextDecoder 实测验证） */
function makeGbkBook(): ArrayBuffer {
  // 手工映射表：仅覆盖本测试用到的字符（Node 无 gb18030 TextEncoder）
  const GBK: Record<string, number[]> = {
    第: [0xb5, 0xda],
    一: [0xd2, 0xbb],
    二: [0xb6, 0xfe],
    三: [0xc8, 0xfd],
    章: [0xd5, 0xc2],
    ' ': [0x20],
    启: [0xc6, 0xf4],
    程: [0xb3, 0xcc],
    遇: [0xd3, 0xf6],
    险: [0xcf, 0xd5],
    转: [0xd7, 0xaa],
    机: [0xbb, 0xfa],
    测: [0xb2, 0xe2],
    试: [0xca, 0xd4],
    之: [0xd6, 0xae],
    书: [0xca, 0xe9],
    作: [0xd7, 0xf7],
    者: [0xd5, 0xdf],
    '：': [0xa3, 0xba],
    员: [0xd4, 0xb1],
    正: [0xd5, 0xfd],
    文: [0xce, 0xc4],
    '\n': [0x0a],
  };
  // 未收录字符会破坏 GBK 一致性，直接失败暴露遗漏
  const text = [
    '测试之书',
    '作者：测试员',
    '第一章 启程',
    '第一章正文',
    '第二章 遇险',
    '第二章正文',
    '第三章 转机',
    '第三章正文',
  ].join('\n');

  const bytes: number[] = [];
  for (const char of text) {
    const encoded = GBK[char];
    if (encoded === undefined) {
      throw new Error(`测试用例遗漏字符的 GBK 映射: ${char}`);
    }
    bytes.push(...encoded);
  }
  // 返回独立 ArrayBuffer（File/Blob 的 BlobPart 需要非 SharedArrayBuffer 视图）
  const out = new Uint8Array(bytes);
  const buffer = new ArrayBuffer(out.length);
  new Uint8Array(buffer).set(out);
  return buffer;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('importTxtFile', () => {
  it('GBK 编码 TXT：自动探测编码，书名取自文件名，章节正确切分', async () => {
    const db = await EbookDb.open();
    const file = new File([makeGbkBook()], '测试小说.txt');

    const meta = await importTxtFile(file, db);

    expect(meta.title).toBe('测试小说');
    expect(meta.format).toBe('txt');
    expect(meta.fileSize).toBe(makeGbkBook().byteLength);
    expect(meta.chapterCount).toBe(3);

    const chapters = await db.getChapters(meta.id);
    expect(chapters.map((c) => c.title)).toEqual([
      '第一章 启程',
      '第二章 遇险',
      '第三章 转机',
    ]);
    // 无乱码（GBK 被正确识别而非按 UTF-8 误读）
    expect(chapters[0].content).toBe('测试之书\n作者：测试员\n第一章正文');
    // 短引言并入第一章，内容零丢失
    expect(chapters[0].content).not.toContain('\uFFFD');
    db.close();
  });

  it('UTF-8 编码 TXT：端到端导入', async () => {
    const db = await EbookDb.open();
    const text = [
      '楔子',
      '引子内容。',
      '第一章 甲',
      '甲正文。',
      '第二章 乙',
      '乙正文。',
      '第三章 丙',
      '丙正文。',
    ].join('\n');
    const file = new File([text], 'utf8书.txt');

    const meta = await importTxtFile(file, db);
    const chapters = await db.getChapters(meta.id);

    expect(meta.chapterCount).toBe(4);
    expect(chapters.map((c) => c.title)).toEqual([
      '楔子',
      '第一章 甲',
      '第二章 乙',
      '第三章 丙',
    ]);
    db.close();
  });

  it('乱码过多的文件应抛出明确错误', async () => {
    const db = await EbookDb.open();
    // 0xFF 不在 GB18030/UTF-8 合法字节内，替换率极高
    const file = new File([new Uint8Array([0xff, 0xff, 0xff, 0xff])], '损坏.txt');

    await expect(importTxtFile(file, db)).rejects.toThrow('乱码');
    db.close();
  });
});

describe('bookTitleFromFilename', () => {
  it('去除 .txt 扩展名', () => {
    expect(bookTitleFromFilename('斗破苍穹.txt')).toBe('斗破苍穹');
  });
  it('去除大写扩展名', () => {
    expect(bookTitleFromFilename('book.TXT')).toBe('book');
  });
  it('无扩展名时原样返回并去首尾空白', () => {
    expect(bookTitleFromFilename('  我的书 ')).toBe('我的书');
  });
  it('空文件名回退为未命名', () => {
    expect(bookTitleFromFilename('.txt')).toBe('未命名');
  });
});
