import type { BookMeta } from '@/types/book';

import { decodeBuffer } from '@/core/encoding/detect';
import { splitChapters } from '@/core/txt/chapter-splitter';

import type { EbookDb } from '@/platform/db/repository';

/**
 * TXT 导入管线：File → 解码 → 章节切分 → 入库。
 * 成功后返回书籍元信息（含章节计数）。
 */

/** File → ArrayBuffer（封装为独立函数，便于测试替换） */
export async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/** 从文件名推导书名，去除扩展名 */
export function bookTitleFromFilename(filename: string): string {
  return filename.replace(/\.(txt|TXT)$/, '').trim() || '未命名';
}

export async function importTxtFile(
  file: File,
  db: EbookDb,
): Promise<BookMeta> {
  const buffer = await readFileBuffer(file);

  // 编码探测：GBK/GB18030 与 UTF-8 自动识别，避免硬编码导致的乱码
  const decoded = decodeBuffer(buffer);
  if (decoded.replacementRatio > 0.05) {
    throw new Error(
      '文件解码后乱码过多，可能是不支持的二进制或损坏的文本文件',
    );
  }

  const split = splitChapters(decoded.text);

  const now = Date.now();
  const meta: BookMeta = {
    id: crypto.randomUUID(),
    title: bookTitleFromFilename(file.name),
    format: 'txt',
    fileSize: file.size,
    chapterCount: split.chapters.length,
    addedAt: now,
    lastReadAt: 0,
  };

  const chapters = split.chapters.map((chapter, idx) => ({
    idx,
    title: chapter.title,
    content: chapter.content,
    contentType: 'text' as const,
    charCount: chapter.title.length + chapter.content.length,
  }));

  await db.putBook(meta);
  await db.putChapters(meta.id, chapters);

  return meta;
}
