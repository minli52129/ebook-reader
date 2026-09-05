import type { BookMeta } from '@/types/book';

import { appStore } from '@/store/app-store';
import { navigate } from '@/ui/router';

import { importTxtFile } from '@/platform/import/import-txt';
import { importEpubFile } from '@/platform/import/import-epub';
import type { EbookDb } from '@/platform/db/repository';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTime(timestamp: number): string {
  if (timestamp === 0) return '未读';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderBookshelf(
  root: HTMLElement,
  db: EbookDb,
): void {
  const { books } = appStore.get();

  root.innerHTML = `
    <div class="view bookshelf-view">
      <header class="shelf-header">
        <h1>📖 我的书架</h1>
        <div class="shelf-header-actions">
          <a class="btn-ghost" href="#/music">🎵 音乐播放器</a>
          <button id="upload-btn" class="btn-primary">+ 添加 TXT / EPUB</button>
        </div>
        <input id="file-input" type="file" accept=".txt,.TXT,.epub,.EPUB" multiple hidden>
      </header>
      <div id="shelf-status" class="shelf-status" hidden></div>
      <div id="book-list" class="book-list"></div>
    </div>
  `;

  const statusEl = root.querySelector<HTMLDivElement>('#shelf-status');
  const showStatus = (message: string, isError: boolean): void => {
    if (statusEl === null) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('error', isError);
    statusEl.hidden = false;
    if (!isError) {
      window.setTimeout(() => {
        statusEl.hidden = true;
      }, 2500);
    }
  };

  const listEl = root.querySelector<HTMLDivElement>('#book-list');
  if (listEl === null) return;

  if (books.length === 0) {
    listEl.innerHTML = `
      <div class="empty-tip">
        书架空空如也<br>
        点击「添加 TXT 小说」导入文件，数据仅保存在本浏览器
      </div>
    `;
  } else {
    listEl.innerHTML = books
      .map(
        (book: BookMeta) => `
      <article class="book-card" data-id="${book.id}">
        ${
          book.coverUrl !== undefined
            ? `<img class="book-cover-img" src="${book.coverUrl}" alt="" loading="lazy">`
            : '<div class="book-cover" aria-hidden="true">📄</div>'
        }
        <div class="book-info">
          <h3 class="book-title">${escapeHtml(book.title)}</h3>
          <p class="book-meta">
            ${book.format.toUpperCase()} · 共 ${book.chapterCount} 章 · ${formatSize(book.fileSize)}
          </p>
          <p class="book-time">最近阅读：${formatTime(book.lastReadAt)}</p>
        </div>
        <button class="btn-delete" data-del="${book.id}" aria-label="删除">✕</button>
      </article>
    `,
      )
      .join('');
  }

  const fileInput = root.querySelector<HTMLInputElement>('#file-input');
  const uploadBtn = root.querySelector<HTMLButtonElement>('#upload-btn');
  uploadBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (files.length === 0) return;

    let ok = 0;
    for (const file of files) {
      try {
        if (/\.epub$/i.test(file.name)) {
          await importEpubFile(file, db);
        } else {
          await importTxtFile(file, db);
        }
        ok += 1;
      } catch (error) {
        showStatus(`《${file.name}》导入失败：${(error as Error).message}`, true);
      }
    }
    if (ok > 0) {
      showStatus(`成功导入 ${ok} 本小说`, false);
      await refreshBooks(db);
    }
  });

  listEl.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = btn.dataset.del;
      const book = books.find((b) => b.id === id);
      if (id !== undefined && book !== undefined && window.confirm(`确定删除《${book.title}》？此操作不可恢复。`)) {
        void (async () => {
          await db.deleteBook(id);
          await refreshBooks(db);
        })();
      }
    });
  });

  listEl.querySelectorAll<HTMLElement>('.book-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (id !== undefined) {
        navigate({ name: 'reader', bookId: id });
      }
    });
  });
}

export async function refreshBooks(db: EbookDb): Promise<void> {
  try {
    appStore.set({ books: await db.getAllBooks() });
  } catch (error) {
    appStore.set({ fatal: `读取书库失败：${(error as Error).message}` });
  }
}
