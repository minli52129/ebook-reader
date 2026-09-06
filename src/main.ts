import '@/ui/styles/base.css';
import '@/ui/styles/app.css';

import { EbookDb } from '@/platform/db/repository';
import { appStore } from '@/store/app-store';
import { renderBookshelf, refreshBooks } from '@/ui/components/bookshelf';
import { ReaderView } from '@/ui/components/reader';
import { onRouteChange, parseHash, type Route } from '@/ui/router';

const found = document.querySelector<HTMLDivElement>('#app');

if (found === null) {
  document.body.innerHTML = '<p style="padding:24px">初始化失败：找不到 #app 挂载点</p>';
  throw new Error('找不到 #app 挂载点，请检查 index.html');
}

// 收窄后的引用：const 窄化不能跨闭包保留，需显式声明非空类型
const app: HTMLDivElement = found;

function renderFatal(message: string): void {
  app.innerHTML = `
    <main class="boot">
      <h1>⚠️ 无法启动</h1>
      <p>${message}</p>
      <p>浏览器隐私模式可能禁用了本地存储，或存储空间已满。</p>
    </main>
  `;
}

async function main(): Promise<void> {
  let db: EbookDb;
  try {
    db = await EbookDb.open();
  } catch (error) {
    renderFatal(`本地数据库初始化失败：${(error as Error).message}`);
    return;
  }

  try {
    const settings = await db.getSettings();
    if (settings !== undefined) {
      appStore.set({ settings });
    }
    await refreshBooks(db);
  } catch (error) {
    renderFatal(`读取数据失败：${(error as Error).message}`);
    return;
  }

  let readerView: ReaderView | null = null;

  const render = async (route: Route): Promise<void> => {
    // 离开阅读视图：落盘进度、解绑全局监听
    if (readerView !== null) {
      readerView.destroy();
      readerView = null;
    }

    if (appStore.get().fatal !== null) {
      renderFatal(appStore.get().fatal ?? '未知错误');
      return;
    }

    if (route.name === 'reader') {
      readerView = new ReaderView(app, db, route.bookId);
      await readerView.open();
    } else {
      renderBookshelf(app, db);
    }
  };

  onRouteChange((route) => {
    void render(route);
  });

  await render(parseHash(location.hash));

  // PWA：注册 Service Worker（仅生产环境，避免开发时缓存干扰）
  registerServiceWorker();
}

/** 注册 Service Worker；开发环境跳过以便热更新 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // 开发环境（localhost 且有 HMR）不注册，避免缓存旧资源
  if (import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service Worker 注册失败', error);
    });
  });
}

void main();
