# 📖 电子书阅读器

网页版电子书阅读器，支持 **TXT / EPUB**，数据全部保存在浏览器本地 IndexedDB，无需后端、无需账号。

> ⚖️ 本项目只是一个本地文件阅读器，不内置任何书源、爬取或下载功能。请仅用于阅读你合法拥有的文档。

---

## 技术栈

| 类别 | 选型 | 版本 |
|---|---|---|
| 构建 | Vite | ^8.2.2 |
| 语言 | TypeScript | ~5.9.3（见下方「为何不是 TS 7」） |
| 测试 | Vitest + happy-dom + fake-indexeddb | ^5.0.0 |
| 规范 | ESLint + typescript-eslint | ^10.10.0 / ^8.69.0 |
| EPUB | JSZip | ^3.10.1 |
| 净化 | DOMPurify | ^3.4.14 |

不引入 React / Vue。阅读器的性能瓶颈在排版测量与分页，框架的虚拟 DOM 在此反而是负担。

---

## 架构

核心原则：**`core/` 与 `platform/` 严格分离**。

```
src/
├── core/        纯逻辑，零浏览器 API，100% 可单元测试
│   ├── encoding/    编码探测（UTF-8 / GB18030）
│   ├── txt/         章节识别
│   ├── epub/        container / OPF / nav / 路径解析 / 净化
│   ├── pagination/  分页算法（仅依赖 IMeasurer 接口）
│   ├── position/    ReadingAnchor ↔ Page 映射
│   └── search/      全文搜索
├── platform/    唯一允许触碰浏览器 API 的层
│   ├── db/          IndexedDB schema / repository / 旧数据迁移
│   ├── measurer/    IMeasurer 的 DOM 实现（唯一读写 offsetHeight 的地方）
│   ├── files/       File → ArrayBuffer → 解码
│   └── resources/   EPUB 资源 Blob URL 生命周期
├── store/       状态容器
├── ui/          组件、主题、路由
└── workers/     解析与搜索 Worker
```

分页算法只依赖 `IMeasurer` 接口而非 DOM，因此可用假测量器完整覆盖分页边界、
跨章切页、死循环防护等逻辑；真实 DOM 测量被隔离在 `platform/measurer/`。

### 存储设计

```
IndexedDB  库名 ebook-reader
├── books     书籍元信息（轻量，书架列表用）
├── chapters  章节正文（大文本）
├── progress  阅读进度（高频微写入，与书库解耦）
├── settings  阅读设置
└── marks     书签 / 高亮 / 笔记
```

进度写入只涉及几十字节，不会因翻页而序列化整个书库。

### 位置锚点

进度以 `ReadingAnchor { chapterIdx, offsetInChapter }` 记录，与视口、字号、行距
完全无关。改字号或旋转屏幕后位置不会漂移。

---

## 开发

```bash
npm install        # 首次安装依赖
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 预览构建产物
npm run test       # 单元测试
npm run coverage   # 测试覆盖率
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit（src 与配置文件两套 tsconfig）
npm run verify     # lint + test + build 一键全检
```

需要 DOM 的测试文件，在**首行**声明环境（Vitest 5 已移除 `environmentMatchGlobs`）：

```ts
// @vitest-environment happy-dom
```

---

## 已知环境约束

**为何 `legacy-peer-deps=true`**
`vitest@5` 声明了 12 个 optional peerDependencies，其中 `@vitest/browser-webdriverio`
带有 `webdriverio` 传递 peer 环，会触发 npm 10.9.2 arborist 崩溃：

```
TypeError: Cannot read properties of null (reading 'edgesOut')
    at #loadPeerSet (arborist/lib/arborist/build-ideal-tree.js:1289)
```

项目级 `.npmrc` 关闭自动 peer 解析以保证本机与 CI 行为一致。代价是 peer 冲突不再
自动拦截，需人工核对——已核对项记录在 `.npmrc` 注释中。

**为何不是 TypeScript 7**
`typescript-eslint@8.69.0` 的 peer 范围为 `>=4.8.4 <6.1.0`，TypeScript 7.0.2
（Go 原生重写版）超出范围。待 typescript-eslint 适配后升级。

**Node 版本**
ESLint 10 系列声明支持 `^20.19.0 || ^22.13.0 || >=24`，本机 Node v23.11.0 落在
版本缝隙中，安装时会有 EBADENGINE 警告——**实测功能正常**。CI 固定使用 Node 22 LTS。

---

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架：Vite + TS + ESLint + Vitest + CI | ✅ 完成 |
| M1 | TXT 端到端：编码探测 + 章节识别 + IndexedDB + 书架 | ⬜ |
| M2 | 排版引擎：懒分页 + 缓存 + 锚点 + 翻页/主题/设置 | ⬜ |
| M3 | EPUB：解包 + OPF + nav + 净化 + 资源 | ⬜ |
| M4 | 体验：搜索 + 书签/高亮/笔记 + 滚动模式 | ⬜ |
| M5 | PWA 离线 + GitHub Pages 部署 | ⬜ |

M1 待办中包含一项质量升级：ESLint 规则集由 `recommended` 升级为
`recommendedTypeChecked`，引入 `no-floating-promises` 等类型感知规则，
对异步 IndexedDB / EPUB 代码价值很大。

---

## 部署

推送到 `master` 后由 `.github/workflows/deploy.yml` 自动执行
lint → typecheck → coverage → build，并发布到 GitHub Pages。

构建使用相对 `base: './'`，因此产物同时兼容 GitHub Pages 子目录与本地直接打开
`dist/index.html`，无需为部署路径改动配置。
