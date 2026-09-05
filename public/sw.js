/**
 * Service Worker：离线优先缓存应用壳。
 *
 * 策略：
 *   - 预缓存：install 时缓存应用壳（index.html + 带 hash 的静态资源）
 *   - 导航请求：network-first，离线时回退缓存的 index.html（SPA 路由兼容）
 *   - 静态资源：cache-first（hash 命名，安全长期缓存）
 *
 * 数据（IndexedDB 中的书库）本就存在浏览器本地，离线自然可读。
 */

const CACHE_NAME = 'ebook-reader-v1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 同域请求才干预（跨域如 data: blob: 放行）
  if (url.origin !== self.location.origin) return;

  // SPA 导航请求：network-first，离线回退应用壳
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached ?? caches.match('./'))),
    );
    return;
  }

  // 静态资源：cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached !== undefined) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
    }),
  );
});
