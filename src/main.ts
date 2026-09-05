import '@/ui/styles/base.css';

import { DEFAULT_SETTINGS } from '@/types/settings';

const app = document.querySelector<HTMLDivElement>('#app');

if (app === null) {
  throw new Error('找不到 #app 挂载点，请检查 index.html');
}

app.innerHTML = `
  <main class="boot">
    <h1>📖 电子书阅读器</h1>
    <p>M0 脚手架已就绪 · TXT / EPUB 支持开发中</p>
    <p>当前默认排版：<code>${DEFAULT_SETTINGS.fontSize}px / ${DEFAULT_SETTINGS.lineHeight}</code></p>
  </main>
`;
