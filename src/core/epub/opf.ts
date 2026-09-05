/**
 * OPF（package.opf）解析。
 *
 * 关键语义：**spine 的 itemref 顺序才是真实阅读顺序**，
 * manifest 顺序仅是资源清单 —— 混用二者是 EPUB 解析最常见的错误。
 */

export interface OpfManifestItem {
  id: string;
  href: string;
  mediaType: string;
  /** properties 空格分隔列表，如 "nav" / "cover-image" / "scripted" */
  properties: string[];
}

export interface OpfSpineItemref {
  idref: string;
  /** linear="no" 的条目（如脚注页）不进入顺序阅读流 */
  linear: boolean;
}

export interface OpfMetadata {
  title?: string;
  author?: string;
  language?: string;
}

export interface OpfResult {
  metadata: OpfMetadata;
  manifest: OpfManifestItem[];
  spine: OpfSpineItemref[];
  /** spine@toc 指向的 NCX manifest id（EPUB2 目录） */
  tocNcxId?: string;
}

function firstText(parent: Element | Document, localName: string): string | undefined {
  const el = Array.from(parent.getElementsByTagName('*')).find(
    (node) => node.localName === localName,
  );
  const text = el?.textContent?.trim();
  return text === '' ? undefined : text;
}

export function parseOpf(xml: string): OpfResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') !== null) {
    throw new Error('OPF 不是合法 XML');
  }

  const metadata: OpfMetadata = {
    title: firstText(doc, 'title'),
    author: firstText(doc, 'creator'),
    language: firstText(doc, 'language'),
  };

  const manifest: OpfManifestItem[] = Array.from(
    doc.getElementsByTagName('manifest')[0]?.getElementsByTagName('item') ?? [],
  )
    .map((item) => ({
      id: item.getAttribute('id') ?? '',
      href: item.getAttribute('href') ?? '',
      mediaType: item.getAttribute('media-type') ?? '',
      properties: (item.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
    }))
    .filter((item) => item.id !== '');

  const spineEl = doc.getElementsByTagName('spine')[0];
  const spine: OpfSpineItemref[] = Array.from(
    spineEl?.getElementsByTagName('itemref') ?? [],
  )
    .map((ref) => ({
      idref: ref.getAttribute('idref') ?? '',
      linear: ref.getAttribute('linear') !== 'no',
    }))
    .filter((ref) => ref.idref !== '');

  const toc = spineEl?.getAttribute('toc');
  const tocNcxId = toc === null || toc === '' ? undefined : toc;

  if (manifest.length === 0) {
    throw new Error('OPF 缺少 manifest');
  }
  if (spine.length === 0) {
    throw new Error('OPF 缺少 spine，无法确定阅读顺序');
  }

  return { metadata, manifest, spine, tocNcxId };
}

/** manifest id → item 索引 */
export function manifestIndex(opf: OpfResult): Map<string, OpfManifestItem> {
  return new Map(opf.manifest.map((item) => [item.id, item]));
}

/** manifest 中 properties 含指定标记的第一个 item（如 "nav" / "cover-image"） */
export function findManifestByProperty(
  opf: OpfResult,
  property: string,
): OpfManifestItem | undefined {
  return opf.manifest.find((item) => item.properties.includes(property));
}

/** 按 id 查 manifest */
export function findManifestById(
  opf: OpfResult,
  id: string,
): OpfManifestItem | undefined {
  return opf.manifest.find((item) => item.id === id);
}
