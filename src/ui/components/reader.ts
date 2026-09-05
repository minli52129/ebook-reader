import type { BookMeta, Chapter, Mark } from '@/types/book';
import type { Page, ReadingAnchor } from '@/types/reader';
import type { ReaderSettings } from '@/types/settings';

import { appStore } from '@/store/app-store';
import { navigate } from '@/ui/router';

import { PaginationCache, layoutKeyOf } from '@/core/pagination/cache';
import { findPageByOffset, paginateChapter } from '@/core/pagination/paginator';
import { clampAnchor, pageToAnchor, percentForAnchor } from '@/core/position/anchor';
import { searchInChapters } from '@/core/search/searcher';

import type { EbookDb } from '@/platform/db/repository';
import { DomMeasurer } from '@/platform/measurer/dom-measurer';
import { SettingsPanel, fontFamilyCss } from '@/ui/components/settings-panel';
import { SearchPanel } from '@/ui/components/search-panel';
import { TocPanel } from '@/ui/components/toc-panel';

const SAVE_DEBOUNCE_MS = 500;
const RESIZE_DEBOUNCE_MS = 300;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * 章节规范文本：分页与锚点的统一基准。
 * EPUB 章节为净化后的 HTML，无法按标签切片 —— 提取纯文本分页
 * （已知折衷：分页模式下 EPUB 的内联图片不可见，滚动模式完整保留）。
 */
function chapterPlainText(chapter: Chapter): string {
  if (chapter.contentType === 'text') {
    return chapter.content;
  }
  const holder = document.createElement('div');
  holder.innerHTML = chapter.content;
  return (holder.textContent ?? '').replace(/\s+\n/g, '\n');
}

/**
 * 阅读视图（M2）：
 * - 分页模式：DomMeasurer 测量 + 按章懒分页 + LRU 缓存 + 锚点精确恢复
 * - 滚动模式：按章滚动（M1 行为）
 * - 设置面板：字号/行距/边距/字体/主题/模式，持久化到 IndexedDB
 */
export class ReaderView {
  private readonly root: HTMLElement;
  private readonly db: EbookDb;
  private readonly bookId: string;

  private book: BookMeta | null = null;
  private chapters: Chapter[] = [];

  private settings: ReaderSettings;
  private readonly cache = new PaginationCache();
  private measurer: DomMeasurer | null = null;

  private chapterIdx = 0;
  private pageIdx = 0;
  private pages: Page[] = [];
  private restoredOffset = 0;

  private settingsPanel: SettingsPanel | null = null;
  private searchPanel: SearchPanel | null = null;
  private tocPanel: TocPanel | null = null;
  private marks: Mark[] = [];
  private saveTimer: number | null = null;
  private resizeTimer: number | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(root: HTMLElement, db: EbookDb, bookId: string) {
    this.root = root;
    this.db = db;
    this.bookId = bookId;
    this.settings = appStore.get().settings;
  }

  async open(): Promise<void> {
    const book = await this.db.getBook(this.bookId);
    if (book === undefined) {
      appStore.set({ fatal: '书籍不存在或已被删除' });
      navigate({ name: 'bookshelf' });
      return;
    }
    this.book = book;
    await this.db.putBook({ ...book, lastReadAt: Date.now() });

    this.chapters = await this.db.getChapters(this.bookId);
    this.marks = await this.db.getMarksByBook(this.bookId);

    const progress = await this.db.getProgress(this.bookId);
    const anchor: ReadingAnchor = progress
      ? clampAnchor(this.chapters, progress.anchor)
      : { chapterIdx: 0, offsetInChapter: 0 };
    this.chapterIdx = anchor.chapterIdx;
    this.restoredOffset = anchor.offsetInChapter;

    this.renderChrome();
    if (this.settings.mode === 'paged') {
      this.paginateCurrent(this.restoredOffset);
    } else {
      this.renderScrollContent();
    }
    this.bindGlobal();
  }

  /** 离开视图时调用：落盘进度并解绑全局监听 */
  destroy(): void {
    this.flushSave();
    this.measurer?.destroy();
    this.measurer = null;
    document.removeEventListener('keydown', this.onKeydown);
    if (this.resizeHandler !== null) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  // ---------- 排版 ----------

  private contentWidth(): number {
    const content = this.root.querySelector('.page-content');
    const w = content instanceof HTMLElement ? content.clientWidth : window.innerWidth;
    return w || window.innerWidth;
  }

  private contentHeight(): number {
    const area = this.root.querySelector('.page-area');
    const h = area instanceof HTMLElement ? area.clientHeight : window.innerHeight;
    return h || window.innerHeight;
  }

  private measurerOptions() {
    return {
      fontSize: this.settings.fontSize,
      lineHeight: this.settings.lineHeight,
      fontFamily: fontFamilyCss(this.settings.fontFamily),
      widthPx: Math.max(120, this.contentWidth() - this.settings.margin * 2),
    };
  }

  /** 按章懒分页：优先命中缓存，未命中才做 DOM 测量 */
  private paginateCurrent(restoreOffset: number): void {
    const chapter = this.chapters[this.chapterIdx];
    if (chapter === undefined) return;

    const layoutKey = layoutKeyOf({
      ...this.measurerOptions(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: this.settings.margin,
      maxWidth: this.settings.maxWidth,
    });

    const cached = this.cache.get(this.bookId, this.chapterIdx, layoutKey);
    if (cached !== undefined) {
      this.pages = cached;
    } else {
      if (this.measurer === null) {
        const area = this.root.querySelector('.page-area');
        this.measurer = new DomMeasurer(
          area instanceof HTMLElement ? area : this.root,
          this.measurerOptions(),
        );
      }
      this.pages = paginateChapter({
        chapter,
        chapterIdx: this.chapterIdx,
        measurer: this.measurer,
        maxHeight: Math.max(
          this.measurer.lineHeightPx,
          this.contentHeight() - this.settings.margin * 2,
        ),
        layoutKey,
        // EPUB 章节：以提取后的纯文本为分页/锚点基准
        text: `${chapter.title}\n${chapterPlainText(chapter)}`,
      });
      this.cache.set(this.bookId, this.chapterIdx, layoutKey, this.pages);
    }

    this.pageIdx = findPageByOffset(this.pages, restoreOffset);
    this.renderPage();
  }

  /** 排版参数变化后的重排：仅当前章，按锚点恢复位置（不全量重跑） */
  private relayout(): void {
    const oldOffset = this.pages[this.pageIdx]?.startOffset ?? this.restoredOffset;
    this.cache.clear();
    this.measurer?.destroy();
    this.measurer = null;

    this.applyTheme();
    this.renderChrome();
    if (this.settings.mode === 'paged') {
      this.paginateCurrent(oldOffset);
    } else {
      this.renderScrollContent();
    }
  }

  // ---------- 渲染 ----------

  private currentPercent(): number {
    const anchor: ReadingAnchor =
      this.settings.mode === 'paged'
        ? (this.pages[this.pageIdx] !== undefined
          ? pageToAnchor(this.pages[this.pageIdx])
          : { chapterIdx: this.chapterIdx, offsetInChapter: 0 })
        : { chapterIdx: this.chapterIdx, offsetInChapter: 0 };
    return percentForAnchor(this.chapters, anchor);
  }

  private applyTheme(): void {
    const view = this.root.querySelector('.reader-view');
    if (view instanceof HTMLElement) {
      view.dataset.theme = this.settings.theme;
    }
  }

  private renderChrome(): void {
    const title = this.book?.title ?? '阅读';
    const percent = Math.round(this.currentPercent() * 100);
    const paged = this.settings.mode === 'paged';

    this.root.innerHTML = `
      <div class="view reader-view" data-theme="${this.settings.theme}">
        <header class="reader-header">
          <button class="btn-ghost" data-role="back">← 书架</button>
          <span class="reader-title">${escapeHtml(title)}</span>
          <span class="reader-tools">
            <button class="btn-icon" data-role="toc" aria-label="目录">☰</button>
            <button class="btn-icon" data-role="search" aria-label="搜索">🔍</button>
            <button class="btn-icon" data-role="bookmark" aria-label="添加书签">🔖</button>
            <span class="reader-percent">${percent}%</span>
          </span>
        </header>

        ${
          paged
            ? `
        <div class="page-area">
          <div class="page-content"></div>
          <div class="tap-zone" data-role="tap-prev"></div>
          <div class="tap-zone" data-role="tap-next"></div>
        </div>
        <footer class="reader-footer">
          <button class="btn-primary" data-role="page-prev">上一页</button>
          <span class="page-indicator"></span>
          <button class="btn-primary" data-role="page-next">下一页</button>
        </footer>`
            : `
        <div class="scroll-area">
          <article class="reader-article">
            <h2 class="chapter-title"></h2>
            <div class="chapter-content"></div>
          </article>
        </div>
        <footer class="reader-footer">
          <button class="btn-primary" data-role="ch-prev">上一章</button>
          <select class="ch-select" data-role="ch-select" aria-label="跳转章节"></select>
          <button class="btn-primary" data-role="ch-next">下一章</button>
        </footer>`
        }

        <button class="float-settings" data-role="settings" aria-label="阅读设置">⚙</button>
        <div class="panel-root" data-role="panel-root" hidden></div>
        <div class="panel-root" data-role="panel-root-2" hidden></div>
      </div>
    `;

    this.applyTheme();
    this.applyTypography();
    this.bindChrome();
  }

  /** 把字号/字体/边距等排版样式作用到渲染容器（与 DomMeasurer 保持一致） */
  private applyTypography(): void {
    const content = this.root.querySelector('.page-content');
    const article = this.root.querySelector('.reader-article');
    const target = content ?? article;
    if (target instanceof HTMLElement) {
      target.style.padding = `${this.settings.margin}px`;
      if (content !== null) {
        target.style.fontFamily = fontFamilyCss(this.settings.fontFamily);
      }
    }
    const widthHost = content ?? article;
    if (widthHost instanceof HTMLElement) {
      widthHost.style.maxWidth = `${this.settings.maxWidth}px`;
    }
  }

  private renderPage(): void {
    const page = this.pages[this.pageIdx];
    const content = this.root.querySelector('.page-content');
    const indicator = this.root.querySelector('.page-indicator');
    const headerPercent = this.root.querySelector('.reader-percent');

    if (page !== undefined && content instanceof HTMLElement) {
      const html = page.fragment
        .split('\n')
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('');
      content.innerHTML = html === '' ? '<p class="empty-chapter">（本章无内容）</p>' : html;
    }
    if (indicator !== null) {
      indicator.textContent = `${this.pageIdx + 1} / ${this.pages.length}`;
    }
    if (headerPercent !== null) {
      headerPercent.textContent = `${Math.round(this.currentPercent() * 100)}%`;
    }
    this.scheduleSave();
  }

  private renderScrollContent(): void {
    const chapter = this.chapters[this.chapterIdx];
    const titleEl = this.root.querySelector('.chapter-title');
    const contentEl = this.root.querySelector('.chapter-content');
    const select = this.root.querySelector<HTMLSelectElement>('[data-role="ch-select"]');
    const percentEl = this.root.querySelector('.reader-percent');

    if (chapter !== undefined) {
      if (titleEl !== null) titleEl.textContent = chapter.title;
      if (contentEl instanceof HTMLElement) {
        if (chapter.contentType === 'html') {
          // EPUB：内容已在导入时净化（DOMPurify + 显式剥离），可直接渲染
          contentEl.innerHTML = chapter.content;
        } else {
          contentEl.innerHTML = chapter.content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join('');
        }
      }
    }
    if (select !== null) {
      select.innerHTML = this.chapters
        .map(
          (c, idx) =>
            `<option value="${idx}" ${idx === this.chapterIdx ? 'selected' : ''}>${escapeHtml(c.title)}</option>`,
        )
        .join('');
    }
    if (percentEl !== null) {
      percentEl.textContent = `${Math.round(this.currentPercent() * 100)}%`;
    }
    this.scheduleSave();
  }

  // ---------- 导航 ----------

  private nextPage(): void {
    if (this.pageIdx < this.pages.length - 1) {
      this.pageIdx += 1;
      this.renderPage();
      return;
    }
    if (this.chapterIdx < this.chapters.length - 1) {
      this.chapterIdx += 1;
      this.paginateCurrent(0);
    }
  }

  private prevPage(): void {
    if (this.pageIdx > 0) {
      this.pageIdx -= 1;
      this.renderPage();
      return;
    }
    if (this.chapterIdx > 0) {
      this.chapterIdx -= 1;
      // 回到上一章的最后一页：先按超界偏移定位（findPageByOffset 归末页）
      this.paginateCurrent(Number.MAX_SAFE_INTEGER);
    }
  }

  private changeChapter(delta: number): void {
    const next = this.chapterIdx + delta;
    if (next >= 0 && next < this.chapters.length) {
      this.chapterIdx = next;
      if (this.settings.mode === 'paged') {
        this.paginateCurrent(0);
      } else {
        this.renderScrollContent();
      }
    }
  }

  // ---------- 搜索 / 目录 / 书签 ----------

  private openSearch(): void {
    const root = this.root.querySelector<HTMLElement>('[data-role="panel-root-2"]');
    if (root === null) return;
    root.hidden = false;
    this.searchPanel = new SearchPanel(
      root,
      {
        onClose: () => {
          root.hidden = true;
          this.searchPanel = null;
        },
        onJump: (chapterIdx, offset) => {
          root.hidden = true;
          this.searchPanel = null;
          this.jumpTo(chapterIdx, offset);
        },
      },
      searchInChapters,
    );
    this.searchPanel.setChapters(this.chapters);
  }

  private openToc(): void {
    const root = this.root.querySelector<HTMLElement>('[data-role="panel-root-2"]');
    if (root === null) return;
    root.hidden = false;
    this.tocPanel = new TocPanel(
      root,
      {
        onClose: () => {
          root.hidden = true;
          this.tocPanel = null;
        },
        onJump: (chapterIdx, offset) => {
          root.hidden = true;
          this.tocPanel = null;
          this.jumpTo(chapterIdx, offset);
        },
      },
    );
    this.tocPanel.setData(this.chapters, this.book?.toc, this.marks);
  }

  /** 跳转到指定章节+偏移（分页模式恢复页，滚动模式切章） */
  private jumpTo(chapterIdx: number, offset: number): void {
    this.chapterIdx = clampAnchor(this.chapters, { chapterIdx, offsetInChapter: 0 }).chapterIdx;
    if (this.settings.mode === 'paged') {
      this.paginateCurrent(offset);
    } else {
      this.renderScrollContent();
    }
  }

  private async toggleBookmark(): Promise<void> {
    const anchor: ReadingAnchor =
      this.settings.mode === 'paged' && this.pages[this.pageIdx] !== undefined
        ? pageToAnchor(this.pages[this.pageIdx])
        : { chapterIdx: this.chapterIdx, offsetInChapter: 0 };

    // 同位置已存在书签则删除（切换），否则新增
    const existing = this.marks.find(
      (m) => m.type === 'bookmark' && m.anchor.chapterIdx === anchor.chapterIdx && m.anchor.offsetInChapter === anchor.offsetInChapter,
    );
    if (existing !== undefined) {
      await this.db.deleteMark(existing.id);
    } else {
      const chapter = this.chapters[anchor.chapterIdx];
      const preview =
        chapter?.contentType === 'html'
          ? chapter.content.replace(/<[^>]+>/g, '').slice(0, 60)
          : chapter?.content.slice(0, 60) ?? '';
      const mark: Mark = {
        id: crypto.randomUUID(),
        bookId: this.bookId,
        type: 'bookmark',
        anchor,
        text: preview,
        createdAt: Date.now(),
      };
      await this.db.putMark(mark);
    }
    this.marks = await this.db.getMarksByBook(this.bookId);
  }

  private openSettings(): void {
    const panelRoot = this.root.querySelector<HTMLElement>('[data-role="panel-root"]');
    if (panelRoot === null) return;
    panelRoot.hidden = false;
    this.settingsPanel = new SettingsPanel(panelRoot, this.settings, {
      onClose: () => {
        panelRoot.hidden = true;
        this.settingsPanel = null;
      },
      onChange: (patch) => {
        this.settings = { ...this.settings, ...patch };
        appStore.set({ settings: this.settings });
        void this.persistSettings();

        const panelRootNow = this.root.querySelector<HTMLElement>('[data-role="panel-root"]');
        const isPanelOpen = panelRootNow !== null && panelRootNow.hidden === false;
        const needsRelayout = ['fontSize', 'lineHeight', 'margin', 'fontFamily', 'maxWidth', 'mode'].some(
          (key) => key in patch,
        );

        if (needsRelayout) {
          this.relayout();
          if (isPanelOpen && this.settingsPanel !== null) {
            // relayout 会重建 DOM，重开面板
            this.openSettings();
          }
        } else {
          this.applyTheme();
          this.settingsPanel?.update(this.settings);
        }
      },
    });
  }

  private async persistSettings(): Promise<void> {
    try {
      await this.db.putSettings(this.settings);
    } catch (error) {
      console.warn('保存设置失败', error);
    }
  }

  // ---------- 进度 ----------

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, SAVE_DEBOUNCE_MS);
  }

  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.book === null || this.chapters.length === 0) return;

    const anchor: ReadingAnchor =
      this.settings.mode === 'paged' && this.pages[this.pageIdx] !== undefined
        ? pageToAnchor(this.pages[this.pageIdx])
        : { chapterIdx: this.chapterIdx, offsetInChapter: 0 };

    try {
      await this.db.putProgress({
        bookId: this.bookId,
        anchor,
        percent: percentForAnchor(this.chapters, anchor),
        updatedAt: Date.now(),
      });
    } catch (error) {
      // 进度保存失败不中断阅读
      console.warn('保存阅读进度失败', error);
    }
  }

  // ---------- 事件 ----------

  private bindChrome(): void {
    this.root.querySelector('[data-role="back"]')?.addEventListener('click', () => {
      void this.flushSave().then(() => {
        this.destroy();
        navigate({ name: 'bookshelf' });
      });
    });
    this.root.querySelector('[data-role="settings"]')?.addEventListener('click', () => {
      this.openSettings();
    });
    this.root.querySelector('[data-role="toc"]')?.addEventListener('click', () => this.openToc());
    this.root.querySelector('[data-role="search"]')?.addEventListener('click', () => this.openSearch());
    this.root.querySelector('[data-role="bookmark"]')?.addEventListener('click', () => {
      void this.toggleBookmark();
    });

    const tapPrev = this.root.querySelector('[data-role="tap-prev"]');
    const tapNext = this.root.querySelector('[data-role="tap-next"]');
    tapPrev?.addEventListener('click', () => this.prevPage());
    tapNext?.addEventListener('click', () => this.nextPage());
    this.root.querySelector('[data-role="page-prev"]')?.addEventListener('click', () => this.prevPage());
    this.root.querySelector('[data-role="page-next"]')?.addEventListener('click', () => this.nextPage());

    this.root.querySelector('[data-role="ch-prev"]')?.addEventListener('click', () => this.changeChapter(-1));
    this.root.querySelector('[data-role="ch-next"]')?.addEventListener('click', () => this.changeChapter(1));
    this.root.querySelector('[data-role="ch-select"]')?.addEventListener('change', (event) => {
      const value = Number((event.target as HTMLSelectElement).value);
      if (Number.isInteger(value) && value >= 0 && value < this.chapters.length) {
        this.chapterIdx = value;
        this.renderScrollContent();
      }
    });
  }

  private bindGlobal(): void {
    document.addEventListener('keydown', this.onKeydown);
    this.resizeHandler = () => {
      if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.resizeTimer = null;
        if (this.settings.mode === 'paged') {
          this.relayout();
        }
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('pagehide', () => {
      void this.flushSave();
    });
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (this.settings.mode !== 'paged') return;
    if (event.key === 'ArrowRight') this.nextPage();
    else if (event.key === 'ArrowLeft') this.prevPage();
  };
}
