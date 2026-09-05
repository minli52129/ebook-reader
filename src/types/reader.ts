/**
 * 排版参数快照 —— 分页缓存的失效依据。
 * 任一字段变化都必须重新分页。
 */
export interface Layout {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  viewportWidth: number;
  viewportHeight: number;
  /** 页边距 px */
  margin: number;
  /** 版心最大宽度 px，控制长行可读性 */
  maxWidth: number;
}

/**
 * 稳定阅读锚点 —— 与视口、字号、行距完全无关。
 *
 * 取代旧实现中「累加 pages[i].text.length」的合成偏移：
 * 那种偏移混入了分页时追加的换行符，不对应源文本任何真实位置，
 * 改字号后位置会漂移。锚点记录「第几章 + 章内第几个字符」，永远精确。
 */
export interface ReadingAnchor {
  chapterIdx: number;
  /** 章节内字符偏移，0 表示章首 */
  offsetInChapter: number;
}

/** 分页后的一页 */
export interface Page {
  chapterIdx: number;
  /** 章内起始偏移（含） */
  startOffset: number;
  /** 章内结束偏移（不含） */
  endOffset: number;
  /** 渲染片段：TXT 为转义后的 HTML，EPUB 为净化 HTML 切片 */
  fragment: string;
}

/** 单章分页结果 */
export interface ChapterPagination {
  chapterIdx: number;
  pages: Page[];
  /** 生成该结果时的排版键，用于缓存校验 */
  layoutKey: string;
}

/** 阅读进度（progress 表的一行，写入极频繁，必须保持精简） */
export interface ReadingProgress {
  bookId: string;
  anchor: ReadingAnchor;
  /** 0–1，按字符数加权而非章节序号，避免长短章混排时进度失真 */
  percent: number;
  updatedAt: number;
}
