// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import JSZip from 'jszip';
import { IDBFactory } from 'fake-indexeddb';

import { EbookDb } from '@/platform/db/repository';

import { importEpubFile } from './import-epub';

/** 一像素 PNG 的文件头（足够验证 data URL 内联逻辑） */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHAPTER1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>c1</title></head>
  <body>
    <h1>第一章 启程</h1>
    <p>这是第一章的正文。</p>
    <img src="../images/cover.png" alt="插图"/>
    <script>alert('evil')</script>
    <p onclick="steal()">带事件的段落</p>
    <a href="javascript:evil()">危险链接</a>
  </body>
</html>`;

const CHAPTER2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><h1>第二章 遇险</h1><p>这是第二章的正文。</p></body>
</html>`;

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="text/chapter1.xhtml">第一章 启程</a></li>
        <li><a href="text/chapter2.xhtml">第二章 遇险</a></li>
      </ol>
    </nav>
  </body>
</html>`;

/** manifest 顺序故意与 spine 顺序不同 —— 验证阅读顺序取 spine */
function buildOpf(withNav: boolean): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>EPUB 测试书</dc:title>
    <dc:creator>测试员</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    ${withNav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

async function buildEpub(withNav: boolean): Promise<File> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/content.opf', buildOpf(withNav));
  if (withNav) zip.file('OEBPS/nav.xhtml', NAV);
  zip.file('OEBPS/text/chapter1.xhtml', CHAPTER1);
  zip.file('OEBPS/text/chapter2.xhtml', CHAPTER2);
  zip.file('OEBPS/images/cover.png', PNG_BYTES);

  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buffer], '测试.epub');
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('importEpubFile', () => {
  it('端到端：spine 顺序、标题提取、图片内联、脚本剥离、目录、封面', async () => {
    const db = await EbookDb.open();
    const meta = await importEpubFile(await buildEpub(true), db);

    // OPF metadata 优先于文件名
    expect(meta.title).toBe('EPUB 测试书');
    expect(meta.author).toBe('测试员');
    expect(meta.format).toBe('epub');
    expect(meta.chapterCount).toBe(2);
    expect(meta.fileSize).toBeGreaterThan(0);

    // 封面内联为 data URL
    expect(meta.coverUrl?.startsWith('data:image/png;base64,')).toBe(true);

    // 目录嵌套结构与章节序号
    expect(meta.toc).toHaveLength(2);
    expect(meta.toc?.[0]).toMatchObject({ title: '第一章 启程', chapterIdx: 0, level: 1 });

    // 章节：spine 顺序（c1 在前，尽管 manifest 里 c2 先出现）
    const chapters = await db.getChapters(meta.id);
    expect(chapters.map((c) => c.title)).toEqual(['第一章 启程', '第二章 遇险']);
    expect(chapters[0].contentType).toBe('html');

    // 相对路径 ../images/cover.png 被正确解析并内联
    expect(chapters[0].content).toContain('data:image/png;base64,');

    // 净化：script / onclick / javascript: 全部清除，正文保留
    expect(chapters[0].content).not.toContain('<script');
    expect(chapters[0].content).not.toContain('onclick');
    expect(chapters[0].content).not.toContain('javascript:');
    expect(chapters[0].content).toContain('这是第一章的正文。');

    db.close();
  });

  it('EPUB2（无 nav，NCX 目录）回退', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', CONTAINER);
    zip.file(
      'OEBPS/content.opf',
      buildOpf(false).replace(
        '<spine>',
        '<spine toc="ncx">',
      ).replace(
        '</manifest>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>',
      ),
    );
    zip.file(
      'OEBPS/toc.ncx',
      `<?xml version="1.0"?>
      <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
        <navMap>
          <navPoint id="n1" playOrder="1">
            <navLabel><text>第一章 启程</text></navLabel>
            <content src="text/chapter1.xhtml"/>
          </navPoint>
        </navMap>
      </ncx>`,
    );
    zip.file('OEBPS/text/chapter1.xhtml', CHAPTER1);
    zip.file('OEBPS/text/chapter2.xhtml', CHAPTER2);
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const db = await EbookDb.open();
    const meta = await importEpubFile(new File([buffer], 'old.epub'), db);

    expect(meta.toc).toHaveLength(1);
    expect(meta.toc?.[0]).toMatchObject({ title: '第一章 启程', chapterIdx: 0 });
    db.close();
  });

  it('损坏的 EPUB（缺 container）抛出明确错误', async () => {
    const zip = new JSZip();
    zip.file('dummy.txt', 'not an epub');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const db = await EbookDb.open();
    await expect(
      importEpubFile(new File([buffer], 'bad.epub'), db),
    ).rejects.toThrow('container.xml');
    db.close();
  });
});
