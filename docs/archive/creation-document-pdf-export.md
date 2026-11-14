> 已归档：本文为历史过程记录，结论可能已过时。现行方案见 `docs/frontend-redesign-spec-2026-11.md` 与 `docs/product-refocus-plan-2026-11.md`。

# 文档 PDF 导出

2026-10-25。语义文档和 Univer 原生文档均已接入现有固定版本、私有资产校验、后台导出及下载链路。未启动真实数据库、队列 Worker 或修改运行开关。

## 核心代码

- `src/lib/creation/exports/document-pdf-model.js`：语义文档单向适配、原生 AST 读取、段落/表格/图片/页眉页脚模型；原生文档不先反投影成简化格式。
- `document-pdf-layout.js`：换行、分页、首行缩进、制表位、段落保持、重复表头、单元格对齐、页码布局与工作预算。
- `document-pdf.js`：Skia Canvas 4.0.0 直接生成矢量 PDF，逐页绘制、图像和画布释放。
- `src/lib/creation/contracts/exports.js`、`src/lib/domain/creation/exports.js`、`export-execution.js`：按历史版本实际 schema 准入与读取，区分文档和海报/PPT PDF。
- `layout-child.mjs` 与 `src/workers/creation-export-main.mjs`：独立转换子进程和实际 PDF 运行时探测；不进入首页或 Web 转换路径。

## 启用条件

开关默认关闭，不修改实际环境文件。通用工作台和导出准入、匹配 Worker 新鲜心跳、固定版本及资源归属校验仍生效。

| 来源 | 开关 | 转换版本 / Worker 能力 |
|---|---|---|
| 语义 schema 1 | `CREATION_DOCUMENT_PDF_EXPORT_ENABLED` | `document-pdf-1` / `document-pdf` |
| 原生 schema 2 | `CREATION_NATIVE_DOCUMENT_PDF_EXPORT_ENABLED`，以及现有原生 Office 准入 | `univer-document-pdf-1` / `univer-document-pdf` |

导出 Worker 须配置 `CREATION_PDF_RUNTIME=true`，实际探测字体和 Skia PDF 后才发布这些能力。原海报/PPT PDF 开关不会顺带开启文档 PDF。

## 范围与资源

支持常用文字样式、标题、列表、行内图片、显式分页、矩形表格、最小行高、跨页表头、页眉页脚和 PAGE/NUMPAGES。长单词按字素拆分；制表位与悬挂缩进纳入行宽。

独立重新排版，不能保证与 Univer 编辑器逐页一致；链接保留文字，不创建可点击注释；编辑锁不导出。复杂/不支持的原生结构明确拒绝，不静默丢弃。超高表格行不拆成多页，要求调整内容。实际原生文档导出仍受已有转换器的特性准入约束。

上限包括 30 万文本字符、20 万布局工作项、100 页、1 万测量缓存项、解码图片预算 1600 万像素、64 MiB 输出，另受独立转换进程的现有超时/堆/并发限制。上述是拒绝与回收机制，不是生产性能证明。

## 本机验证

定向模型/分页、历史 schema、独立能力开关、Worker 心跳、私有资产及子进程路由测试通过。实际转换测试在单个真实 Node 子进程中生成两种源格式各 5 页 PDF，包含 72 行表格、中文、富文本、列表、图片、重复表头、页眉页脚和页码；pypdf 校验内容与尺寸，Poppler 渲染全部 10 页，并人工检查两份逐页联系图。原生样例包含最小行高及居中/底部单元格对齐。

证据：`artifacts/creation-workbench-20261025/document-pdf/`，含两份 PDF、逐页 PNG、联系图和 `verification.json`。测试入口为 `tests/unit/creation-document-pdf-render.test.mjs`，默认跳过真实渲染，须显式设置 `CREATION_NATIVE_RENDER_TESTS=true`。

Windows 测试字体别名只用于本机测试，不能替代生产镜像的五个 Noto 字体族。沿用 Skia/字体的中文提取边界：当前验证中文可见且能提取部分中文字符，未证明所有字符精确复制/搜索。Linux 字体、真实队列下载、Word/WPS 与生产资源回归仍需验收。
