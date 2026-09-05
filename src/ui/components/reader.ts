import type { Chapter } from '@/types/book';

import { appStore } from '@/store/app-store';
import { navigate } from '@/ui/router';

import type { EbookDb } from '@/platform/db/repository';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** 纯文本 → 段落 HTML（首行缩进两字，空行分段） */
function contentToHtml(chapter: Chapter): string {
  if (chapter.contentType === 'html') {
    return chapter.content; // EPUB 内容已在导入时净化，M3 启用
  }
  const paragraphs = chapter.content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
  return paragraphs === '' ? '<p class="empty-chapter">（本章无内容）</p>' : paragraphs;
}

/**
 * M1 最小阅读视图：按章加载、滚动阅读。
 * 分页排版引擎与精确位置恢复由 M2 提供，当前锚点只记录到章。
 */
export class ReaderView {
  private bookId: string;
  private readonly db: EbookDb;
  private readonly root: HTMLElement;

  private chapters: Chapter[] = [];
  private current = 0;
  private totalChars = 0;

  constructor(root: HTMLElement, db: EbookDb, bookId: string) {
    this.root = root;
    this.db = db;
    this.bookId = bookId;
  }

  async open(): Promise<void> {
    const book = await this.db.getBook(this.bookId);
    if (book === undefined) {
      appStore.set({ fatal: '书籍不存在或已被删除' });
      navigate({ name: 'bookshelf' });
      return;
    }

    // 进入阅读即更新「最近阅读」
    await this.db.putBook({ ...book, lastReadAt: Date.now() });

    this.chapters = await this.db.getChapters(this.bookId);
    this.totalChars = this.chapters.reduce((sum, c) => sum + c.charCount, 0);

    const progress = await this.db.getProgress(this.bookId);
    this.current = progress?.anchor.chapterIdx ?? 0;
    if (this.current >= this.chapters.length) {
      this.current = 0;
    }

    this.render(book.title);
  }

  private render(title: string): void {
    const chapter = this.chapters[this.current];
    const percent =
      this.totalChars > 0
        ? this.chapters
            .slice(0, this.current)
            .reduce((sum, c) => sum + c.charCount, 0) / this.totalChars
        : 0;

    const options = this.chapters
      .map(
        (c, idx) =>
          `<option value="${idx}" ${idx === this.current ? 'selected' : ''}>${escapeHtml(c.title)}</option>`,
      )
      .join('');

    this.root.innerHTML = `
      <div class="view reader-view" data-theme="${appStore.get().settings.theme}">
        <header class="reader-header">
          <button id="back-btn" class="btn-ghost">← 书架</button>
          <span class="reader-title">${escapeHtml(title)}</span>
          <span class="reader-percent">${Math.round(percent * 100)}%</span>
        </header>
        <article class="reader-article">
          <h2 class="chapter-title">${escapeHtml(chapter.title)}</h2>
          <div class="chapter-content">${contentToHtml(chapter)}</div>
        </article>
        <footer class="reader-footer">
          <button id="prev-ch" class="btn-primary" ${this.current === 0 ? 'disabled' : ''}>上一章</button>
          <select id="ch-select" class="ch-select" aria-label="跳转章节">${options}</select>
          <button id="next-ch" class="btn-primary" ${
            this.current >= this.chapters.length - 1 ? 'disabled' : ''
          }>下一章</button>
        </footer>
      </div>
    `;

    this.bind();
  }

  private bind(): void {
    this.root.querySelector('#back-btn')?.addEventListener('click', () => {
      void this.saveProgress();
      navigate({ name: 'bookshelf' });
    });

    this.root.querySelector('#prev-ch')?.addEventListener('click', () => {
      if (this.current > 0) {
        this.current -= 1;
        this.rerender();
      }
    });

    this.root.querySelector('#next-ch')?.addEventListener('click', () => {
      if (this.current < this.chapters.length - 1) {
        this.current += 1;
        this.rerender();
      }
    });

    this.root.querySelector('#ch-select')?.addEventListener('change', (event) => {
      const value = Number((event.target as HTMLSelectElement).value);
      if (Number.isInteger(value) && value >= 0 && value < this.chapters.length) {
        this.current = value;
        this.rerender();
      }
    });
  }

  private rerender(): void {
    void this.saveProgress();
    const title =
      this.root.querySelector('.reader-title')?.textContent ?? '阅读';
    this.render(title);
  }

  private async saveProgress(): Promise<void> {
    if (this.chapters.length === 0) return;
    const before = this.chapters
      .slice(0, this.current)
      .reduce((sum, c) => sum + c.charCount, 0);
    try {
      await this.db.putProgress({
        bookId: this.bookId,
        anchor: { chapterIdx: this.current, offsetInChapter: 0 },
        percent: this.totalChars > 0 ? before / this.totalChars : 0,
        updatedAt: Date.now(),
      });
    } catch (error) {
      // 进度保存失败不中断阅读，仅在控制台留痕
      console.warn('保存阅读进度失败', error);
    }
  }
}
