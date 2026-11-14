# 产品收敛与前端重构方案（2026-11）

## 目标

1. **收敛范围**：主线只保留图像创作、视频创作、电商套图和 PPT，其余创作类型下线并删除代码。
2. **解决卡顿**：画布交互稳定 60fps，工作台首屏可交互时间明显下降。
3. **提升观感**：建立统一设计系统，首页和工作台以作品为中心，达到主流 AI 生图/生视频网站的水准。

顺序不能颠倒：先删减范围，再做性能，最后做视觉。删减后需要优化和重做的代码会少很多。

---

## 一、范围决策

### 保留

| 模块 | 入口 | 说明 |
| --- | --- | --- |
| 图像创作画布 | `/studio-v2`、`StudioWorkbench` | 核心产品，重点重构 |
| 视频创作 | `/video`、`src/components/video` | 保留 |
| 电商套图 Agent | `/commerce`、`src/lib/commerce` | 保留 |
| **PPT（演示文稿）** | `/creation` 中的 `slides` | 保留，收敛为单一引擎（见下文） |
| 账户、计费、支付、后台、素材库、项目、灵感发现 | — | 保留，后台只做必要适配 |

### 删除

| 模块 | 主要代码位置 | 附带删除 |
| --- | --- | --- |
| 文档（document） | `DocumentArtifactEditor`、`useDocumentArtifact`、`native-document-*`、`document-operations`、`contracts/document*`、`exports/document-pdf*`、`exports/*docx*`、`exports/*markdown*`、`api/creation/document-artifacts` | Univer 文档运行时 |
| 表格（sheet） | `SheetArtifactEditor`、`useSheetArtifact`、`native-sheet-*`、`sheet-*`、`contracts/sheet*`、`exports/*xlsx*`、`api/creation/sheet-artifacts`、`univer-*` | `@univerjs/*` 三个依赖 |
| 网页（web） | `Web*.jsx`、`useWebArtifact`、`web-*.js`、`contracts/web*`、`exports/web-zip.js`、`api/creation/web-artifacts`、`api/public-sites`、`api/creation/preview-runtime`、`creation-web-source.worker.js`、`domain/creation/web-publications.js` | `acorn` 依赖；`WebPublication*` 三张表 |
| Creation 中的海报（poster） | `poster-*.js`、`contracts/poster*`、HTML 引擎中 poster 分支 | 海报需求由图像画布承接 |
| Office 导入/参考中的 docx、xlsx | `office/docx.js`、`office/xlsx.js`、`references/*` 的 docx/xlsx 分支 | 仅保留 PPTX 导入；若参考文件只服务于 docx/xlsx，则 `saxes` 一并删除 |
| 旧的服装试穿流程 | `/studio` 重定向页、`api/tryon`、`api/tryons`（先迁移调用方）、`ai/adapters/fashn.js`、模特/场景预设、`demo-assets/garments`、`generate:demo-models` 脚本 | `ModelPreset`、`ScenePreset` 表及后台对应页面 |
| 未使用依赖 | — | `framer-motion`、`react-icons`（src 中零引用），`rxjs`、`exifr` 待确认后删除 |

### PPT 收敛为单一引擎

当前有两套幻灯片编辑器：

- `LayoutEditor`：旧版，`schemaVersion 2`，基于 Konva 布局。
- `HtmlEditor`：新版，`schemaVersion 3`，HTML 幻灯片。PPTX 导入和新的生成结果都输出这个格式。

方案：**只保留 HTML 幻灯片（v3）**。先统计线上 v2 演示文稿的数量：

- 数量少：写一次性迁移脚本，把 v2 转成 v3，或者转为只读并提示"导出后重新导入"。
- 数量多：保留只读查看，停止 v2 编辑，下个版本再删除。

收敛后，导出只保留 PPTX、PDF、PNG。`creation-language` Worker 只保留 slides 和 agent 两条流水线，`creation-export` Worker 只保留幻灯片导出和 PPTX 导入。

Creation 入口（`launcher-items.js`）删掉 poster、document、sheet、web 之后只剩图片、视频、PPT 三项，可以考虑直接并入首页的统一输入框，不再单独设置"创作工作台"入口。

### 线上数据处理

按当前决策，线上数据无需保留，因此不做公告、导出和迁移流程：

1. 删表前做一次完整数据库备份即可。
2. 公开网页链接删除后直接 410 或整条路由移除，不做说明页。
3. `WebPublication*`、`ModelPreset`、`ScenePreset` 等表随对应模块在同一版本删除。

### 预期收益

- 依赖减少：`@univerjs/*`（体积最大的一批）、`acorn`、`framer-motion`、`react-icons`、`saxes`。
- 代码量：`src/lib/creation` 和 `src/components/creation` 预计减少一半以上，数据表减少约 6–8 张。
- Worker：导出 Worker 不再需要 Univer、docx、xlsx 的运行环境，镜像更小。
- 测试：删除对应的单元测试、e2e 测试和 playwright 配置，CI 时间随之下降。

---

## 二、性能

> 性能部分已由 `docs/perf-plan-review-2026-11.md` 扩展：新增"第 0 层·交付"（公开页 HTML 发到香港、压缩、长连接排查），实测线上首页首字节 7.9 秒，收益最大。以下是应用层措施，顺序上应排在交付层之后。

### 0. 交付层（最高优先级，见审查文档 U1）

- 公开页 HTML 纳入香港静态发布，按 `BUILD_TAG` 版本隔离，沿用现有原子切换机制。
- `explore/[slug]` 由 `force-dynamic` 改为静态生成。
- 香港 Nginx 开启 brotli/gzip。
- 排查首页连接 60 秒不结束的问题。

### 1. 先测量

- 接入 Web Vitals 上报（LCP、INP、CLS），按页面汇总。
- 在资源充足的环境（CI 或本地开发机）用 React Profiler 录制三段操作：画布滚轮缩放、拖动图层、在对话框中输入。记录每帧渲染耗时作为基线。
- 用 `next build` 的产物分析，记录 `/studio-v2`、`/`、`/creation` 的首屏 JS 体积。

### 2. 画布交互不走 React

- 位置：`StudioCanvas.jsx` 的 `onWheel` 和拖动处理，以及 `useCanvasState.js` 的 `updateCamera`。
- 交互过程中直接调用 Konva `stage.position()` / `stage.scale()` 和 `batchDraw()`，用 `requestAnimationFrame` 合并成每帧一次。交互结束后（松手，或滚轮停止约 120ms）再提交到 React 状态。
- 依赖 camera 的叠加层（缩放控件、选区工具条）改为订阅一个轻量的 camera store，不再通过 props 层层传递。
- 静态图层设置 `listening(false)`；大图在低缩放比例下用缩略图，可以对 Konva Layer 做缓存。

### 3. 拆分 StudioWorkbench

把约 40 个 `useState` 移到一个分片的 store 中（沿用项目已有的 `useSyncExternalStore` 模式，或引入 zustand），按区域拆成独立组件，每个组件只订阅自己需要的数据：

```
StudioWorkbench（布局外壳，不持有业务状态）
├── StudioTopBar           项目、保存、导出、积分
├── StudioChatPanel        对话、消息列表、输入区
│   └── StudioComposer     提示词、模型、尺寸、数量、提交
├── StudioCanvasArea       画布 + 叠加层
├── StudioToolDock         底部工具栏
├── StudioToolPanel        当前工具参数（按需懒加载）
└── StudioTaskTray         任务队列（独立订阅轮询/推送）
```

验收标准：任务轮询更新或输入框打字时，画布不重渲染。

### 4. 全局负担

- `NextIntlClientProvider` 只下发当前页面需要的翻译命名空间。
- `globals.css`（70KB）拆分：设计 token 和基础样式保留在全局，页面和组件样式就近放置或改用 Tailwind 工具类。
- 排查 CDN 上 `_next/static` 偶发加载失败的根因（缓存规则、回源、跨域头）。修复后删除 `StylesheetRecovery`。
- 任务状态统一用 SSE 推送（`api/studio/events` 已有基础），各页面不再各自轮询。

### 性能目标

| 指标 | 目标 |
| --- | --- |
| 中国网络首字节（首页） | 小于 500ms（当前实测 7.9s） |
| 画布缩放/拖动 | 稳定 60fps，单帧脚本耗时小于 8ms |
| 工作台 INP | 小于 200ms |
| 首页 LCP | 小于 2.0s（4G 网络、中端设备） |
| `/studio-v2` 首屏 JS | 比基线下降 40% 以上 |

基线测量与 CI 预算见 `docs/perf-plan-review-2026-11.md` U5。

---

## 三、设计系统

### 原则

- 以作品为中心：界面本身要克制，色彩和视觉重点交给生成结果。
- 一套组件，一种语言：同一种功能只有一个组件和一种外观。
- 规则写进 lint，靠工具防止回退，不靠自觉。

### Token

完整规格见 `docs/frontend-redesign-spec-2026-11.md` 第 2 章，这里只列要点：

- **颜色**：一组中性灰阶，加**唯一强调色品牌橙 `#FF6A2B`**（浅色主题下压暗为 `#C9430C`），再加成功、警告、错误三个状态色。深色和浅色两套主题。
- **字号阶梯**：12 / 13 / 14 / 16 / 20 / 28 / 40。正文最小 13px，辅助文字最小 12px，取消 10–11px。
- **间距**：4 的倍数。**圆角**：四档，8（控件）/ 12（输入框内元素）/ 18（卡片）/ 28（面板）。
- **中文字体**：选用 MiSans 或 HarmonyOS Sans，按常用字做子集化后本地托管，和 Geist 搭配。Instrument Serif 只用于英文大标题。

### 组件（先做以下 16 个）

Button、IconButton、Segmented、Select、Input / Textarea、Combobox、Popover、Dialog、Toast、Tooltip、Tabs、Card、Skeleton、Progress、EmptyState、Avatar。

当前组件中的原生 `<select>`、各式各样的胶囊按钮、手写弹层全部替换成上面这套组件。

### Lint 约束

- 禁止在组件中写十六进制色值（当前有 223 处），以及 `text-[10px]`、`rounded-[...]` 这类任意值写法。
- `max-lines`（单文件 400 行）和 Prettier（行宽 120），防止代码被压成超长行。
- 现有 `scripts/design-check.py` 扩展成上述检查，纳入 `check:static`。

---

## 四、页面重做

### 首页

- 首屏：一句标题，加一个统一输入框。图片、视频、PPT、电商套图由输入内容自动识别，也可以通过输入框内的小标签切换。不再要求用户先选 tab。
- 下方：作品瀑布流，作为第一视觉。点击作品可以"做同款"，自动带入提示词和参数。
- 左侧导航收敛为：首页、图像、视频、PPT、电商套图、我的作品、素材库。

### 图像工作台

- 画布为主，左侧对话面板默认更窄，可以折叠。
- 生成过程：提交后立即在画布上出现占位卡，显示排队和进度，完成后模糊渐显。
- 结果卡悬浮操作：重新生成、变体、高清放大、局部重绘、转视频、下载。
- 空状态换成产品相关的示例和快捷操作，不再使用无关的风景照。

### 视频、PPT、电商套图

套用同一套布局外壳（顶栏、侧栏、主区域）和组件，统一生成中、失败、空状态的表现。

---

## 五、工程与仓库

- **仓库清理**：从 git 中移除提交进去的截图和测试产物（约 100 个），补全 `.gitignore`（`artifacts/`、`test-results-*`、`docker/**/node_modules`）。根目录的一次性计划文档（`docs/archive/EVALUATION.md`、`docs/archive/OPTIMIZATION_PLAN.md`、`PERFORMANCE_*.md`）移到 `docs/archive/`。
- **文档**：`docs/` 拆成"现行规范"（架构、部署、运维、设计系统）和 `docs/archive/`（带日期的过程记录）。
- **类型**：`src/lib/domain/billing` 和 `src/lib/domain/generation` 先加 `// @ts-check` 和 JSDoc。
- **命名**：`TryOn` 模型在代码中改名为 `GenerationOutput`，通过 Prisma `@@map("TryOn")` 保持表名不变。和删除试穿流程放在同一阶段做。

---

## 六、排期

| 阶段 | 内容 | 预估 | 交付方式 |
| --- | --- | --- | --- |
| **-1** | **交付层：公开页 HTML 发到香港、开启压缩、长连接排查** | **3–4 天** | 1 个 PR，只改 CI 与 Nginx |
| 0 | 测量基线（Web Vitals 上报、CI 性能预算）、仓库清理 | 3–5 天 | 1 个 PR |
| 1 | 删除 document、sheet、web、poster，删除试穿流程、未用依赖；PPT 收敛到 v3 | 1.5–2 周 | 按模块拆成 4–5 个 PR，每个 PR 可以独立回滚 |
| 2 | 画布相机改造、拆分 StudioWorkbench、翻译和 CSS 拆分、SSE 统一 | 2 周 | 3–4 个 PR，每个附 Profiler 前后对比 |
| 3 | 设计 token、字体、16 个基础组件、lint 约束 | 2 周 | 组件可以先在后台页面试用 |
| 4 | 首页、图像工作台重做，视频、PPT、电商套图套用新外壳 | 3 周 | 用功能开关灰度上线 |

阶段 -1 必须最先做：它收益最大、成本最低，不依赖其他任何阶段。阶段 1 和 2 可以部分并行，两者分别改动 creation 和 studio，冲突很少。完整的阶段划分见 `docs/perf-plan-review-2026-11.md` 第三节。

## 七、风险

| 风险 | 应对 |
| --- | --- |
| 删除模块影响仍在使用的用户 | 先统计数据，再公告、提供导出，停写和删表分两个版本做 |
| 模块之间存在隐性耦合（共用的 contracts、HTML 引擎、导出 Worker） | 每个模块单独一个 PR，删除后完整跑一遍 CI 验收，不合并大 PR |
| 画布改造引入交互回归 | 现有 canvas 相关 Playwright 用例作为回归保护，改造前先补齐缩放和拖动用例 |
| 视觉重做周期长 | 先上线设计系统和组件，新页面用功能开关灰度，旧页面保留到新页面稳定 |

## 验证说明

本方案基于静态阅读代码得出。删除范围中标注"待确认"的依赖，以及模块之间的引用关系，需要在执行每个 PR 时用全量 lint、构建和测试来确认。按当前服务器资源限制，这些检查交由 CI 执行。
