import type { ReadingAnchor } from './reader';

/** 书籍来源格式 */
export type BookFormat = 'txt' | 'epub';

/** 章节内容形态：TXT 为纯文本，EPUB 为净化后的 HTML */
export type ContentType = 'text' | 'html';

/**
 * 书籍元信息 —— 只存轻量字段，用于书架列表渲染。
 * 章节正文单独存放在 chapters 表，避免书架列表加载时拖入全文。
 */
export interface BookMeta {
  /** crypto.randomUUID() 生成 */
  id: string;
  title: string;
  author?: string;
  language?: string;
  format: BookFormat;
  /** 原始文件字节数 */
  fileSize: number;
  /** 封面（EPUB 封面转 dataURL；TXT 无封面时为 undefined） */
  coverUrl?: string;
  chapterCount: number;
  addedAt: number;
  lastReadAt: number;
}

/** 单个章节 */
export interface Chapter {
  /** 书内序号，从 0 开始 */
  idx: number;
  title: string;
  /** TXT → 纯文本；EPUB → DOMPurify 净化后的 HTML */
  content: string;
  contentType: ContentType;
  /** 用于进度百分比与分页预估，避免重复读取 content.length */
  charCount: number;
}

/**
 * 目录条目。
 * EPUB 的 nav.xhtml / NCX 支持多级嵌套，TXT 章节恒为单级（level = 1）。
 */
export interface TocEntry {
  id: string;
  title: string;
  /** 指向 chapters 表中的章节序号 */
  chapterIdx: number;
  /** 嵌套层级，从 1 开始 */
  level: number;
  children?: TocEntry[];
}

/** 书签 / 高亮 / 笔记 */
export type MarkType = 'bookmark' | 'highlight' | 'note';

export interface Mark {
  id: string;
  bookId: string;
  type: MarkType;
  /** 锚点位置，与排版参数无关 */
  anchor: ReadingAnchor;
  /** 高亮/笔记对应的选中文本 */
  text?: string;
  /** 仅 type === 'note' 时使用 */
  note?: string;
  color?: string;
  createdAt: number;
}
