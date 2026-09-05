// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { parseContainerXml } from './container';
import { parseNavToc, parseNcxToc, draftToTocEntries } from './nav';
import { parseOpf, findManifestByProperty } from './opf';
import { dirname, decodeHref, resolveZipPath } from './resolver';

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    <rootfile full-path="wrong.opf" media-type="other"/>
  </rootfiles>
</container>`;

const OPF_XML = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试之书</dc:title>
    <dc:creator>测试员</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="text/chapter3.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3" linear="no"/>
  </spine>
</package>`;

describe('resolver（zip 路径解析）', () => {
  it('dirname 取目录', () => {
    expect(dirname('OEBPS/content.opf')).toBe('OEBPS');
    expect(dirname('content.opf')).toBe('');
    expect(dirname('a/b/c.opf')).toBe('a/b');
  });

  it('decodeHref 容忍非法百分号序列', () => {
    expect(decodeHref('%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml')).toBe('第一章.xhtml');
    expect(decodeHref('bad%2')).toBe('bad%2');
  });

  it('相对路径基于 OPF 目录解析', () => {
    expect(resolveZipPath('OEBPS', 'text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
    expect(resolveZipPath('OEBPS/text', '../style/main.css')).toBe('OEBPS/style/main.css');
    expect(resolveZipPath('OEBPS', 'nav.xhtml#sec-2')).toBe('OEBPS/nav.xhtml');
    expect(resolveZipPath('', 'a.xhtml')).toBe('a.xhtml');
  });

  it('百分号编码的中文路径', () => {
    expect(resolveZipPath('OEBPS', '%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml')).toBe(
      'OEBPS/第一章.xhtml',
    );
  });

  it('多余的 ../ 不逃出 zip 根', () => {
    expect(resolveZipPath('OEBPS', '../../../../etc/passwd')).toBe('etc/passwd');
  });
});

describe('container.xml', () => {
  it('按 media-type 选取 OPF rootfile', () => {
    expect(parseContainerXml(CONTAINER_XML).rootFilePath).toBe('OEBPS/content.opf');
  });

  it('非法 XML 抛错', () => {
    expect(() => parseContainerXml('<not-closed>')).toThrow('container.xml');
  });

  it('缺 rootfile 抛错', () => {
    const xml =
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles/></container>';
    expect(() => parseContainerXml(xml)).toThrow('full-path');
  });
});

describe('OPF', () => {
  const opf = parseOpf(OPF_XML);

  it('metadata 提取标题/作者/语言（兼容 dc: 前缀）', () => {
    expect(opf.metadata.title).toBe('测试之书');
    expect(opf.metadata.author).toBe('测试员');
    expect(opf.metadata.language).toBe('zh');
  });

  it('manifest 解析出 properties', () => {
    expect(findManifestByProperty(opf, 'nav')?.id).toBe('nav');
    expect(findManifestByProperty(opf, 'cover-image')?.href).toBe('images/cover.png');
  });

  it('spine 保留 itemref 顺序与 linear 标记', () => {
    expect(opf.spine.map((s) => s.idref)).toEqual(['ch1', 'ch2', 'ch3']);
    expect(opf.spine[2].linear).toBe(false);
    expect(opf.spine[0].linear).toBe(true);
  });

  it('spine 为空时抛错（无法确定阅读顺序）', () => {
    const noSpine = OPF_XML.replace(/<spine>[\s\S]*<\/spine>/, '<spine></spine>');
    expect(() => parseOpf(noSpine)).toThrow('spine');
  });
});

describe('目录解析', () => {
  const NAV_XHTML = `<?xml version="1.0"?>
  <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
    <body>
      <nav epub:type="toc" id="toc">
        <ol>
          <li><a href="text/chapter1.xhtml">第一章</a></li>
          <li><a href="text/part.xhtml">第一部分</a>
            <ol>
              <li><a href="text/chapter2.xhtml">第二章</a></li>
            </ol>
          </li>
        </ol>
      </nav>
      <nav epub:type="landmarks"><ol><li><a href="cover.xhtml">封面</a></li></ol></nav>
    </body>
  </html>`;

  const NCX_XML = `<?xml version="1.0"?>
  <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <navMap>
      <navPoint id="n1" playOrder="1">
        <navLabel><text>序章</text></navLabel>
        <content src="text/preface.xhtml"/>
      </navPoint>
      <navPoint id="n2" playOrder="2">
        <navLabel><text>第一章</text></navLabel>
        <content src="text/chapter1.xhtml"/>
      </navPoint>
    </navMap>
  </ncx>`;

  it('EPUB3 nav：选中 epub:type=toc 的 nav 而非 landmarks', () => {
    const drafts = parseNavToc(NAV_XHTML);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].title).toBe('第一章');
    expect(drafts[1].title).toBe('第一部分');
    expect(drafts[1].children).toEqual([{ title: '第二章', href: 'text/chapter2.xhtml' }]);
  });

  it('EPUB2 NCX：navPoint 嵌套解析', () => {
    const drafts = parseNcxToc(NCX_XML);
    expect(drafts.map((d) => d.title)).toEqual(['序章', '第一章']);
    expect(drafts[0].href).toBe('text/preface.xhtml');
  });

  it('draftToTocEntries：href 映射回填章节序号', () => {
    const hrefMap = new Map([
      ['text/chapter1.xhtml', 0],
      ['text/part.xhtml', 1],
      ['text/chapter2.xhtml', 2],
    ]);
    const entries = draftToTocEntries(parseNavToc(NAV_XHTML), hrefMap);
    expect(entries).toHaveLength(2);
    expect(entries[0].chapterIdx).toBe(0);
    expect(entries[1].chapterIdx).toBe(1);
    expect(entries[1].children?.[0]).toMatchObject({
      title: '第二章',
      chapterIdx: 2,
      level: 2,
    });
  });

  it('draftToTocEntries：指向被跳过章节且无子节点的条目被丢弃', () => {
    const entries = draftToTocEntries([{ title: '幽灵章', href: 'ghost.xhtml' }], new Map());
    expect(entries).toEqual([]);
  });
});
