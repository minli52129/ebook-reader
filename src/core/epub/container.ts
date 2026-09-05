/**
 * META-INF/container.xml 解析 —— 定位 OPF 文件。
 *
 * 结构：
 *   <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
 *     <rootfiles>
 *       <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
 *     </rootfiles>
 *   </container>
 *
 * 依赖 DOMParser（browser / happy-dom）。解析失败抛出带上下文的错误。
 */

export interface EpubContainer {
  rootFilePath: string;
}

export function parseContainerXml(xml: string): EpubContainer {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError !== null) {
    throw new Error('container.xml 不是合法 XML');
  }

  // 支持命名空间前缀差异：同时尝试标准名与 localName 匹配
  const rootfiles = Array.from(doc.getElementsByTagName('rootfile'));
  const rootfile =
    rootfiles.find((el) => el.getAttribute('media-type') === 'application/oebps-package+xml') ??
    rootfiles[0];

  const fullPath = rootfile?.getAttribute('full-path');
  if (fullPath === null || fullPath === undefined || fullPath === '') {
    throw new Error('container.xml 缺少 rootfile full-path');
  }
  return { rootFilePath: fullPath };
}
