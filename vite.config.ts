import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对 base：同时兼容 GitHub Pages 子目录与本地直接打开 dist/index.html，
  // 规避方案风险 R5（子路径导致资源 404）
  base: './',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    reportCompressedSize: false,
  },

  test: {
    // 全局用 node 环境；需要 DOM 的测试文件在首行声明
    //   // @vitest-environment happy-dom
    // 这是 Vitest 5 推荐做法（environmentMatchGlobs 已移除）
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/ui/**',
      ],
    },
  },
});
