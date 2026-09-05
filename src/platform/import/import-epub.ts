import JSZip from 'jszip';
import DOMPurify from 'dompurify';

import type { BookMeta } from '@/types/book';

import { bookTitleFromFilename } from '@/platform/import/import-txt';

import { parseContainerXml } from '@/core/epub/container';
import { draftToTocEntries, parseNavToc, parseNcxToc, type TocDraft } from '@/core/epub/nav';
import {
  decodeHref,
  dirname,
  resolveZipPath,
} from '@/core/epub/resolver';
import {
  findManifestByProperty,
  parseOpf,
  type OpfManifestItem,
  type OpfResult,
} from '@/core/epub/opf';

import type { EbookDb } from '@/platform/db/repository';

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (entry === null) {
    throw new Error(`EPUB 内缺少文件: ${path}`);
  }
  return entry.async('text');
}

/** 扩展名推断图片 MIME（容错：EPUB 常缺 data URI 所需的类型信息） */
function imageMediaType(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MEDIA_TYPES[ext] ?? null;
}

/** zip 内图片 → data URL（自包含，可直接存 IndexedDB，无需 Blob 生命周期管理） */
async function zipImageToDataUrl(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (entry === null) return null;
  const mediaType = imageMediaType(path);
  if (mediaType === null) return null;
  const base64 = await entry.async('base64');
  return `data:${mediaType};base64,${base64}`;
}

/**
 * 净化章节 XHTML 并把图片内联为 data URL。
 * DOMPurify 白名单清除 <script>/事件属性/javascript: URL。
 *
 * 标题在净化**之前**从解析后的 DOM 提取 —— 标题提取不应依赖
 * 净化器的标签白名单（例如测试环境 happy-dom 下 DOMPurify 会剥掉 h1）。
 */
async function sanitizeChapterHtml(
  rawXhtml: string,
  zip: JSZip,
  baseDir: string,
): Promise<{ html: string; title: string | null }> {
  const parser = new DOMParser();
  let doc = parser.parseFromString(rawXhtml, 'application/xhtml+xml');
  if (doc.querySelector('parsererror') !== null) {
    doc = parser.parseFromString(rawXhtml, 'text/html');
  }
  const body = doc.body ?? doc.documentElement;

  // 标题：净化前提取第一个 h1-h6
  const heading = body.querySelector('h1, h2, h3, h4, h5, h6');
  const title = heading?.textContent?.trim() ?? null;

  // 内联 <img src> 与 SVG <image xlink:href>
  const imageEls: Array<{ el: Element; attr: string; value: string }> = [];
  for (const img of Array.from(body.getElementsByTagName('img'))) {
    const src = img.getAttribute('src');
    if (src !== null && src !== '') imageEls.push({ el: img, attr: 'src', value: src });
  }
  for (const image of Array.from(body.getElementsByTagName('image'))) {
    for (const attrName of ['href', 'xlink:href']) {
      const value = image.getAttribute(attrName);
      if (value !== null && value !== '') imageEls.push({ el: image, attr: 'href', value });
    }
  }

  for (const { el, value } of imageEls) {
    const zipPath = resolveZipPath(baseDir, value);
    const dataUrl = zipPath === '' ? null : await zipImageToDataUrl(zip, zipPath);
    if (dataUrl !== null) {
      el.setAttribute('src', dataUrl);
    } else {
      el.remove(); // 解析失败的图片直接移除，不留破碎引用
    }
  }

  // ---- 纵深防御：显式移除高危节点与属性，不依赖净化器可用性 ----
  // （happy-dom 等环境下 DOMPurify.isSupported 可能为 false，sanitize 会原样返回输入）
  for (const el of Array.from(
    body.querySelectorAll('script, style, iframe, object, embed, form, link, meta'),
  )) {
    el.remove();
  }
  for (const el of Array.from(body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name); // 事件处理器
      } else if (
        (name === 'href' || name === 'src' || name === 'xlink:href') &&
        (value.startsWith('javascript:') || value.startsWith('data:text/html'))
      ) {
        el.removeAttribute(attr.name); // 危险协议
      }
    }
  }

  // DOMPurify 白名单：浏览器内的第二道防线
  const html = DOMPurify.sanitize(body.innerHTML, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
  });
  return { html, title };
}

/** 从 spine 提取正文章节清单（跳过 linear=no 与非 XHTML 资源） */
export function spineChapterItems(
  opf: OpfResult,
  manifestById: Map<string, OpfManifestItem>,
): OpfManifestItem[] {
  const items: OpfManifestItem[] = [];
  for (const ref of opf.spine) {
    if (!ref.linear) continue;
    const item = manifestById.get(ref.idref);
    if (item === undefined) continue;
    const media = item.mediaType.toLowerCase();
    if (media.includes('xhtml') || media.includes('html')) {
      items.push(item);
    }
  }
  return items;
}

/** 目录草稿的取用优先级：EPUB3 nav → EPUB2 NCX */
function resolveTocDrafts(
  opf: OpfResult,
  manifestById: Map<string, OpfManifestItem>,
  zip: JSZip,
  baseDir: string,
): Promise<TocDraft[]> {
  const navItem = findManifestByProperty(opf, 'nav');
  if (navItem !== undefined) {
    return readZipText(zip, resolveZipPath(baseDir, navItem.href)).then(parseNavToc);
  }
  const ncxId = opf.tocNcxId;
  const ncxItem = ncxId !== undefined ? manifestById.get(ncxId) : undefined;
  if (ncxItem !== undefined) {
    return readZipText(zip, resolveZipPath(baseDir, ncxItem.href)).then(parseNcxToc);
  }
  return Promise.resolve([]);
}

/**
 * EPUB 导入管线：
 *   File → JSZip → container.xml → OPF → spine（真实阅读顺序）
 *   → 逐章净化 + 图片内联 → 目录（nav/NCX）→ IndexedDB
 */
export async function importEpubFile(file: File, db: EbookDb): Promise<BookMeta> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const container = parseContainerXml(await readZipText(zip, 'META-INF/container.xml'));
  const baseDir = dirname(container.rootFilePath);
  const opf = parseOpf(await readZipText(zip, container.rootFilePath));
  const manifestById = new Map(opf.manifest.map((item) => [item.id, item]));

  // ---- 章节内容（spine 顺序 = 阅读顺序） ----
  const chapterItems = spineChapterItems(opf, manifestById);
  if (chapterItems.length === 0) {
    throw new Error('EPUB 无可渲染章节');
  }

  const chapters: Array<{ title: string; content: string; contentType: 'html' }> = [];
  const hrefToChapterIdx = new Map<string, number>();

  // ---- 目录草稿（先于章节解析：章节标题缺失时可回退目录同名项） ----
  let drafts: TocDraft[] | undefined;
  try {
    drafts = await resolveTocDrafts(opf, manifestById, zip, baseDir);
  } catch {
    // 目录解析失败不阻断导入 —— 阅读层会回退用章节标题作单级目录
  }

  for (let idx = 0; idx < chapterItems.length; idx++) {
    const item = chapterItems[idx];
    const zipPath = resolveZipPath(baseDir, item.href);
    // 目录草稿的 href 是相对 OPF 目录的原始形式，与 zip 全路径口径不同，
    // 两种键都登记以兼容（百分号编码 likewise 解码登记）
    hrefToChapterIdx.set(zipPath, idx);
    hrefToChapterIdx.set(decodeHref(item.href.split('#')[0]), idx);

    const raw = await readZipText(zip, zipPath);
    const { html: contentHtml, title: headingTitle } = await sanitizeChapterHtml(
      raw,
      zip,
      dirname(zipPath),
    );

    // 标题：章节内标题优先，缺失时回退目录同名项，再回退「第 N 节」
    const tocTitle = drafts?.find(
      (draft) => decodeHref(draft.href.split('#')[0]) === decodeHref(item.href.split('#')[0]),
    )?.title;
    const title = headingTitle ?? tocTitle ?? `第 ${idx + 1} 节`;

    chapters.push({ title, content: contentHtml, contentType: 'html' });
  }

  // ---- 目录条目 ----
  let toc: BookMeta['toc'];
  if (drafts !== undefined) {
    const entries = draftToTocEntries(drafts, hrefToChapterIdx);
    if (entries.length > 0) toc = entries;
  }

  // ---- 封面 ----
  let coverUrl: string | undefined;
  const coverItem = findManifestByProperty(opf, 'cover-image');
  if (coverItem !== undefined) {
    const dataUrl = await zipImageToDataUrl(zip, resolveZipPath(baseDir, coverItem.href));
    if (dataUrl !== null) coverUrl = dataUrl;
  }

  const now = Date.now();
  const meta: BookMeta = {
    id: crypto.randomUUID(),
    title: opf.metadata.title ?? bookTitleFromFilename(file.name),
    author: opf.metadata.author,
    language: opf.metadata.language,
    format: 'epub',
    fileSize: file.size,
    coverUrl,
    chapterCount: chapters.length,
    addedAt: now,
    lastReadAt: 0,
    toc,
  };

  await db.putBook(meta);
  await db.putChapters(
    meta.id,
    chapters.map((chapter, idx) => ({
      ...chapter,
      idx,
      charCount: chapter.title.length + chapter.content.length,
    })),
  );

  return meta;
}
