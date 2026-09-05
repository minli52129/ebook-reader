import type { Chapter, Mark, TocEntry } from '@/types/book';

export interface TocPanelCallbacks {
  onClose: () => void;
  onJump: (chapterIdx: number, offset: number) => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** 把嵌套 TocEntry 渲染为扁平可点击列表（用缩进表达层级） */
function renderTocEntries(
  entries: readonly TocEntry[],
  onJump: (chapterIdx: number) => void,
): string {
  return entries
    .map((entry) => {
      const indent = (entry.level - 1) * 16;
      return `
        <li class="toc-item" data-chapter="${entry.chapterIdx}" style="padding-left:${indent + 12}px">
          ${escapeHtml(entry.title)}
        </li>
        ${entry.children !== undefined ? renderTocEntries(entry.children, onJump) : ''}
      `;
    })
    .join('');
}

/**
 * 目录侧边栏：EPUB 嵌套目录优先，无目录时回退用章节标题列表；
 * 附加书签/笔记 tab（仅展示当前章节附近 + 跳转）。
 */
export class TocPanel {
  private readonly root: HTMLElement;
  private readonly callbacks: TocPanelCallbacks;
  private chapters: Chapter[] = [];
  private toc: readonly TocEntry[] = [];
  private marks: Mark[] = [];

  constructor(root: HTMLElement, callbacks: TocPanelCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.render();
  }

  setData(
    chapters: Chapter[],
    toc: readonly TocEntry[] | undefined,
    marks: readonly Mark[],
  ): void {
    this.chapters = chapters;
    this.toc = toc ?? [];
    this.marks = [...marks].sort(
      (a, b) => a.anchor.chapterIdx - b.anchor.chapterIdx || a.anchor.offsetInChapter - b.anchor.offsetInChapter,
    );
    this.render();
  }

  private render(): void {
    const useToc = this.toc.length > 0;
    const list = useToc
      ? renderTocEntries(this.toc, (idx) => this.callbacks.onJump(idx, 0))
      : this.chapters
          .map(
            (c) => `<li class="toc-item" data-chapter="${c.idx}">${escapeHtml(c.title)}</li>`,
          )
          .join('');

    const marksList = this.marks
      .map(
        (m) => `
      <li class="toc-item mark-item" data-chapter="${m.anchor.chapterIdx}" data-offset="${m.anchor.offsetInChapter}">
        <span class="mark-icon">${m.type === 'note' ? '📝' : '🔖'}</span>
        <span class="mark-text">${escapeHtml(m.text?.slice(0, 40) ?? this.chapters[m.anchor.chapterIdx]?.title ?? '书签')}</span>
      </li>`,
      )
      .join('');

    this.root.innerHTML = `
      <div class="panel-overlay" data-role="overlay"></div>
      <aside class="side-panel">
        <header class="panel-header">
          <div class="panel-tabs">
            <button class="tab active" data-tab="toc">目录</button>
            <button class="tab" data-tab="marks">书签笔记</button>
          </div>
          <button class="btn-ghost" data-role="close">✕</button>
        </header>
        <div class="panel-body" data-tab-content="toc">
          <ul class="toc-list">${list}</ul>
        </div>
        <div class="panel-body" data-tab-content="marks" hidden>
          <ul class="toc-list">${marksList || '<p class="panel-empty">暂无书签笔记<br>阅读时长按或点书签按钮添加</p>'}</ul>
        </div>
      </aside>
    `;

    this.bind();
  }

  private bind(): void {
    this.root.querySelector('[data-role="close"]')?.addEventListener('click', this.callbacks.onClose);
    this.root.querySelector('[data-role="overlay"]')?.addEventListener('click', this.callbacks.onClose);

    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        this.root.querySelectorAll<HTMLElement>('[data-tab-content]').forEach((c) => {
          c.hidden = c.dataset.tabContent !== target;
        });
      });
    });

    this.root.querySelectorAll<HTMLElement>('.toc-item[data-chapter]').forEach((item) => {
      item.addEventListener('click', () => {
        this.callbacks.onJump(Number(item.dataset.chapter), Number(item.dataset.offset ?? 0));
      });
    });
  }
}
