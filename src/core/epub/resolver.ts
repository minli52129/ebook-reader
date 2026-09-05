/**
 * EPUB 内部路径解析（zip 路径，纯字符串运算，零 DOM）。
 *
 * EPUB 的 href 均相对 OPF 所在目录，且常带百分号编码与 ../ 上跳，
 * 直接拼接会解析失败 —— 这是 EPUB 解析最高频的现实脏数据来源。
 */

/** 取目录部分：'OEBPS/content.opf' → 'OEBPS'；无斜杠 → '' */
export function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** 安全的百分号解码：非法序列原样返回而不是抛错 */
export function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * 以 baseDir 为基准解析相对 href，返回 zip 内规范路径。
 * 处理 ./ 与 ../ 上跳、百分号解码；结果始终不含开头斜杠
 * （JSZip 的路径不带前导 /）。
 */
export function resolveZipPath(baseDir: string, href: string): string {
  const decoded = decodeHref(href.trim());
  // 去掉可能存在的锚点（章节内部跳转）
  const withoutHash = decoded.split('#')[0];
  if (withoutHash === '') return '';

  const segments: string[] = [];
  const baseParts = baseDir === '' ? [] : baseDir.split('/');
  const hrefParts = withoutHash.split('/');

  // href 以 / 开头视为 zip 根相对（非常规但容错处理）
  if (withoutHash.startsWith('/')) {
    for (const part of hrefParts) {
      if (part === '' || part === '.') continue;
      if (part === '..') segments.pop();
      else segments.push(part);
    }
    return segments.join('/');
  }

  for (const part of baseParts) {
    if (part !== '') segments.push(part);
  }
  for (const part of hrefParts) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}
