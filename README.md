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
| M1 | TXT 端到端：编码探测 + 章节识别 + IndexedDB + 书架 | ✅ 完成 |
| M2 | 排版引擎：懒分页 + 缓存 + 锚点 + 翻页/主题/设置 | ✅ 完成 |
| M3 | EPUB：解包 + OPF + nav + 净化 + 资源 | ✅ 完成 |
| M4 | 体验：搜索 + 书签/笔记 + 目录侧边栏 | ✅ 完成 |
| M5 | PWA 离线 + GitHub Pages 部署 | ⬜ |

### M4 已交付

- **全文搜索**（`core/search/searcher.ts`）：跨章节、大小写可配、命中上限、上下文预览；
  纯函数可在 Web Worker 运行；HTML 章节剥离标签后搜索
- **搜索面板**：防抖输入、按章分组、`<mark>` 高亮匹配词、点击跳转到精确位置
- **目录侧边栏**：EPUB 嵌套目录优先，无目录回退章节标题列表；书签/笔记 tab
- **书签**：当前位置一键添加/切换删除，持久化 IndexedDB，预览文本
- **阅读器工具栏**：目录 ☰ / 搜索 🔍 / 书签 🔖 / 设置 ⚙

已知边界（M5 处理）：无 PWA/离线；无高亮文本选区笔记（仅整点书签）；
搜索未用 Worker（纯函数已预留接口，大书可平滑迁移）。

### M3 已交付

- **解析管线**（`core/epub/`）：container.xml → OPF（**spine 顺序 = 真实阅读顺序**，
  与 manifest 顺序无关）→ EPUB3 nav.xhtml / EPUB2 NCX 嵌套目录
- **路径解析**：处理 `../` 上跳、百分号编码、章节内锚点；zip 路径规范
- **章节净化**（`platform/import/import-epub.ts`）：
  - **纵深防御**：显式 DOM 遍历移除 `<script>`/事件属性/`javascript:` 协议，
    不依赖 DOMPurify 可用性（测试暴露 happy-dom 下净化器会原样返回输入）
  - DOMPurify 作为浏览器端第二道防线
  - 图片内联为 data URL（自包含、可存 IndexedDB，无需 Blob 生命周期管理）
- **阅读器**：滚动模式完整渲染净化后的 HTML（含内联图片）；
  分页模式以提取的纯文本为基准（已知折衷：分页模式下内联图片不可见）
- **书架**：接受 `.epub`、显示封面、按扩展名分发到 TXT/EPUB 导入管线
- **验收测试**（`src/core/epub/` + `src/platform/import/`）：
  JSZip 程序化构造最小合法 EPUB（避免 git 塞二进制），覆盖 spine 顺序、
  标题提取、图片内联、脚本剥离、nav/NCX 双路径、封面、损坏文件报错

已知边界（M4 处理）：无全文搜索、无书签/高亮/笔记；
EPUB 字体文件未加载（仅内联图片）；DRM 加密 EPUB 明确不支持。

### M2 已交付

- **分页纯算法**（`core/pagination/paginator.ts`）：测量经 `IMeasurer` 注入，
  零 DOM 依赖可完整单测；页记录 `[startOffset, endOffset)` 相对章节规范文本
  （`title + '\n' + content`）的偏移，无缝覆盖全文
- **DOM 测量器**（`platform/measurer/dom-measurer.ts`）：项目里唯一读写
  `offsetHeight` 的地方，二分查找每页容量；与渲染容器样式严格同步
- **LRU 分页缓存**：键 = 书 + 章 + 排版参数，字号/行距/视口变化天然不命中；
  resize 只重算当前章（修复旧实现全量重跑）
- **锚点精确恢复**：`ReadingAnchor {chapterIdx, offsetInChapter}` 取代旧的
  "分页片段长度累加"，改字号后恢复到包含原位置的页，不跳读不漂移
- **阅读器双模式**：分页（点击分区/按钮/键盘翻页 + 页码指示）与滚动并存；
  设置面板（字号/行距/边距/字体/三主题）持久化到 IndexedDB
- **验收测试**（`tests/perf/layout-engine.test.ts`）：5k 字单章分页 <100ms
  （实际 ~0.4ms）、字号变化位置不漂移、缓存命中零重算、LRU 淘汰语义

已知边界（M3 处理）：仅支持 TXT；EPUB 章节为 HTML 时按纯文本渲染；
页首行为段落中间时无首行缩进（分页切片的已知折衷）。

### M1 已交付

- **编码探测**（`core/encoding`）：BOM 判定 → UTF-8 严格模式 → GB18030 回退，
  修复旧实现硬编码导致的中文乱码
- **章节识别**（`core/txt`）：逐行扫描 + 全行锚定，修复旧实现 `\s` 吞换行导致
  标题吞掉正文首段的缺陷；strong 模式并集兼容「楔子 + 第N章 + 番外」混用目录
- **IndexedDB 存储层**（`platform/db`）：books/chapters/progress/settings/marks
  五表分离，进度微写入与书库解耦，级联删除保证原子性
- **书架 + 最小阅读视图**：多文件导入、删除确认、按章阅读与进度记忆
- **验收测试**：3 本 5MB TXT 并存导入约 1.4s（`tests/perf/`）

已知边界（M2 处理）：阅读视图为按章滚动，无分页排版与章内精确位置恢复；
仅支持 TXT；章节切分对文件内嵌目录行尚未特殊处理。

M1 待办中包含一项质量升级：ESLint 规则集由 `recommended` 升级为
`recommendedTypeChecked`，引入 `no-floating-promises` 等类型感知规则，
对异步 IndexedDB / EPUB 代码价值很大。

---

## 部署

推送到 `master` 后由 `.github/workflows/deploy.yml` 自动执行
lint → typecheck → coverage → build，并发布到 GitHub Pages。

构建使用相对 `base: './'`，因此产物同时兼容 GitHub Pages 子目录与本地直接打开
`dist/index.html`，无需为部署路径改动配置。
