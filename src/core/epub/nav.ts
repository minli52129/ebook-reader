import type { TocEntry } from '@/types/book';

/**
 * EPUB 目录解析：EPUB3 nav.xhtml 优先，EPUB2 toc.ncx 回退。
 *
 * 两者都支持嵌套（多级目录），输出为带 children 的 TocEntry 草稿 ——
 * chapterIdx 由导入层根据 href→spine 序号映射后回填（本层无法得知）。
 */

/** 目录草稿：href 未映射为章节序号 */
export interface TocDraft {
  title: string;
  href: string;
  children?: TocDraft[];
}

/**
 * 解析 EPUB3 nav.xhtml。
 * 定位规则：nav 元素带 epub:type="toc"（属性前缀可能不同，取 localName 判断），
 * 回退取第一个含 ol 的 nav。
 */
export function parseNavToc(navXhtml: string): TocDraft[] {
  const doc = new DOMParser().parseFromString(navXhtml, 'application/xhtml+xml');
  if (doc.querySelector('parsererror') !== null) {
    throw new Error('nav.xhtml 不是合法 XML');
  }

  const navs = Array.from(doc.getElementsByTagName('nav'));
  const tocNav =
    navs.find((nav) =>
      Array.from(nav.attributes).some(
        (attr) => attr.localName === 'type' && attr.value.split(/\s+/).includes('toc'),
      ),
    ) ?? navs.find((nav) => nav.getElementsByTagName('ol').length > 0);

  const ol = tocNav?.getElementsByTagName('ol')[0];
  if (ol === undefined || ol === null) {
    throw new Error('nav.xhtml 中未找到目录列表');
  }

  return parseListItems(ol);
}

/** 递归解析 ol > li > a 结构 */
function parseListItems(ol: Element): TocDraft[] {
  const drafts: TocDraft[] = [];
  for (const li of Array.from(ol.children).filter((el) => el.localName === 'li')) {
    const anchor = Array.from(li.children).find((el) => el.localName === 'a');
    if (anchor === undefined) continue;
    const href = anchor.getAttribute('href') ?? '';
    const nestedOl = Array.from(li.children).find((el) => el.localName === 'ol');
    const children = nestedOl !== undefined ? parseListItems(nestedOl) : undefined;
    drafts.push({
      title: (anchor.textContent ?? '').trim(),
      href,
      children: children !== undefined && children.length > 0 ? children : undefined,
    });
  }
  return drafts;
}

/**
 * 解析 EPUB2 toc.ncx。
 *   <navMap><navPoint id playOrder><navLabel><text>标题</text></navLabel>
 *   <content src="chapter1.xhtml"/></navPoint>…
 */
export function parseNcxToc(ncxXml: string): TocDraft[] {
  const doc = new DOMParser().parseFromString(ncxXml, 'application/xml');
  if (doc.querySelector('parsererror') !== null) {
    throw new Error('toc.ncx 不是合法 XML');
  }

  const navMap = doc.getElementsByTagName('navMap')[0];
  if (navMap === undefined || navMap === null) {
    throw new Error('toc.ncx 缺少 navMap');
  }

  const parsePoints = (parent: Element): TocDraft[] => {
    const drafts: TocDraft[] = [];
    for (const point of Array.from(parent.children).filter(
      (el) => el.localName === 'navPoint',
    )) {
      const label = Array.from(point.getElementsByTagName('text'))[0]?.textContent ?? '';
      const src = Array.from(point.children).find((el) => el.localName === 'content')
        ?.getAttribute('src');
      const children = parsePoints(point);
      drafts.push({
        title: label.trim(),
        href: src ?? '',
        children: children.length > 0 ? children : undefined,
      });
    }
    return drafts;
  };

  return parsePoints(navMap);
}

/** 目录草稿 → TocEntry：按 hrefMap 回填章节序号，无法映射的条目丢弃 */
export function draftToTocEntries(
  drafts: readonly TocDraft[],
  hrefToChapterIdx: ReadonlyMap<string, number>,
): TocEntry[] {
  const convert = (draft: TocDraft, level: number): TocEntry | null => {
    const key = draft.href.split('#')[0];
    const chapterIdx = hrefToChapterIdx.get(key);
    const children = (draft.children ?? [])
      .map((child) => convert(child, level + 1))
      .filter((entry): entry is TocEntry => entry !== null);

    if (chapterIdx === undefined && children.length === 0) {
      return null; // 目录指向的章节被跳过（linear=no 等），且无子节点可保留
    }

    return {
      id: `toc-${level}-${chapterIdx ?? 'x'}-${draft.title}`,
      title: draft.title,
      chapterIdx: chapterIdx ?? children[0].chapterIdx,
      level,
      children: children.length > 0 ? children : undefined,
    };
  };

  return drafts
    .map((draft) => convert(draft, 1))
    .filter((entry): entry is TocEntry => entry !== null);
}
