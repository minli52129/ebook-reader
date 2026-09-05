export type Route =
  | { name: 'bookshelf' }
  | { name: 'reader'; bookId: string }
  | { name: 'music' };

/** 解析 location.hash；未识别的 hash 回退到书架 */
export function parseHash(hash: string): Route {
  const normalized = hash.replace(/^#\/?/, '');
  const readerMatch = /^read\/([A-Za-z0-9-]+)$/.exec(normalized);
  if (readerMatch !== null) {
    return { name: 'reader', bookId: readerMatch[1] };
  }
  if (normalized === 'music') {
    return { name: 'music' };
  }
  return { name: 'bookshelf' };
}

export function navigate(route: Route): void {
  const hash = route.name === 'reader' ? `#/read/${route.bookId}` : '#/';
  if (location.hash === hash) {
    // 同路由重复导航也触发渲染（如刷新书架）
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  location.hash = hash;
}

/** 监听路由变化，返回取消函数 */
export function onRouteChange(callback: (route: Route) => void): () => void {
  const handler = () => {
    callback(parseHash(location.hash));
  };
  window.addEventListener('hashchange', handler);
  return () => {
    window.removeEventListener('hashchange', handler);
  };
}
