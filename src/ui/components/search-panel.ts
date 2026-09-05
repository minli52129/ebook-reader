import type { Chapter } from '@/types/book';
import type { SearchMatch } from '@/core/search/searcher';

export interface SearchPanelCallbacks {
  onClose: () => void;
  onJump: (chapterIdx: number, offset: number) => void;
}

export type SearchFn = (chapters: readonly Chapter[], query: string) => SearchMatch[];

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * 搜索面板：输入框 + 结果列表（按章节分组、上下文预览、点击跳转）。
 * 搜索函数由视图层注入，便于把实现卸载到 Web Worker。
 */
export class SearchPanel {
  private readonly root: HTMLElement;
  private readonly callbacks: SearchPanelCallbacks;
  private readonly searchFn: SearchFn;
  private chapters: Chapter[] = [];
  private query = '';

  constructor(root: HTMLElement, callbacks: SearchPanelCallbacks, searchFn: SearchFn) {
    this.root = root;
    this.callbacks = callbacks;
    this.searchFn = searchFn;
    this.render();
  }

  setChapters(chapters: Chapter[]): void {
    this.chapters = chapters;
  }

  /** 视图层把搜索结果喂入 */
  showResults(query: string, matches: SearchMatch[]): void {
    this.query = query;
    this.renderResults(matches);
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="panel-overlay" data-role="overlay"></div>
      <aside class="side-panel">
        <header class="panel-header">
          <input class="search-input" data-role="input" type="search" placeholder="搜索全文…" aria-label="搜索"/>
          <button class="btn-ghost" data-role="close">✕</button>
        </header>
        <div class="search-results" data-role="results"></div>
      </aside>
    `;

    const input = this.root.querySelector<HTMLInputElement>('[data-role="input"]');
    input?.focus();
    let timer: number | null = null;
    input?.addEventListener('input', () => {
      if (timer !== null) window.clearTimeout(timer);
      const value = input.value;
      timer = window.setTimeout(() => this.runSearch(value), 200);
    });
    this.root.querySelector('[data-role="close"]')?.addEventListener('click', this.callbacks.onClose);
    this.root.querySelector('[data-role="overlay"]')?.addEventListener('click', this.callbacks.onClose);
  }

  private runSearch(query: string): void {
    if (query.trim() === '') {
      this.renderResults([]);
      return;
    }
    this.showResults(query, this.searchFn(this.chapters, query));
  }

  private renderResults(matches: SearchMatch[]): void {
    const container = this.root.querySelector('[data-role="results"]');
    if (container === null) return;

    if (this.query.trim() === '') {
      container.innerHTML = '<p class="panel-empty">输入关键词开始搜索</p>';
      return;
    }
    if (matches.length === 0) {
      container.innerHTML = `<p class="panel-empty">未找到「${escapeHtml(this.query)}」</p>`;
      return;
    }

    // 按章分组
    const byChapter = new Map<number, SearchMatch[]>();
    for (const match of matches) {
      const list = byChapter.get(match.chapterIdx) ?? [];
      list.push(match);
      byChapter.set(match.chapterIdx, list);
    }

    const groups: string[] = [];
    for (const [chapterIdx, list] of byChapter) {
      const title = this.chapters[chapterIdx]?.title ?? `第 ${chapterIdx} 章`;
      const items = list
        .map(
          (m) => `
        <li class="search-item" data-chapter="${chapterIdx}" data-offset="${m.offset}">
          <span class="search-context">
            …${escapeHtml(m.before)}<mark>${escapeHtml(m.match)}</mark>${escapeHtml(m.after)}…
          </span>
        </li>`,
        )
        .join('');
      groups.push(`
        <div class="search-group">
          <h4 class="search-group-title">${escapeHtml(title)}</h4>
          <ul class="search-group-list">${items}</ul>
        </div>`);
    }
    container.innerHTML = `<p class="search-count">共 ${matches.length} 处</p>${groups.join('')}`;

    container.querySelectorAll<HTMLElement>('.search-item').forEach((item) => {
      item.addEventListener('click', () => {
        this.callbacks.onJump(
          Number(item.dataset.chapter),
          Number(item.dataset.offset),
        );
      });
    });
  }
}
