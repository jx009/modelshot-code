# 海报 / PPT PDF 导出实现与验证

更新：2026-10-24。状态：代码与本机定向验证完成，默认关闭；生产字体、真实存储/队列/数据库、完整页面和性能验收尚未完成。这里只覆盖 `schemaVersion: 1` 的结构化海报与幻灯片；文档、表格和网页 PDF 不在这次能力范围内。

## 用户行为

- 海报可选 PNG / JPEG / SVG / PDF；PPT 可选 PPTX / PDF。文档、表格、网页沿用自己的导出格式。
- 新导出先确认编辑并保存，再绑定返回的版本号。后台读取这个固定历史版本，之后继续编辑不改变导出内容。
- 网络丢响应时，浏览器日志保留格式与版本；恢复提交不重新 flush，也不偷换成最新版本。重试历史 PDF 使用原版本、原格式和原尝试次数。
- PDF 按可见幻灯片当前顺序输出，省略隐藏页和演讲备注。海报始终导出唯一画板，不套用幻灯片的隐藏页规则。不同页面可以有不同尺寸。
- PDF 是排版输出文件；继续编辑应打开项目原稿。字体、换行及部分中文复制/搜索结果可能不同，导出弹窗已有对应说明。

## 数据流与核心实现

```text
ExportDialog -> flush -> POST 固定版本与 pdf
  -> requestArtifactExport（归属、开关、版本心跳、全局/用户队列预算、幂等）
  -> ArtifactExport + Outbox（原有后台调度）
  -> 独立 creation-export Worker（concurrency=1）
  -> readLayoutArtifact(固定 revision) -> validateLayoutPdf
  -> 仅查询可见页面中可见图片的私有资产 -> 完整性校验下载
  -> 无业务凭据的 layout-child -> Sharp 解码/旋转 -> Skia/Konva PDF
  -> 检查 PDF 容器、大小 -> 私有对象存储 -> 租约/尝试号 CAS 发布
  -> 鉴权、校验和与字节数受限的下载流
```

核心绘制位于 `src/lib/creation/exports/raster.js`，复用 PNG 的 `createPageScene`：文字、形状、旋转、透明度、图片 contain/cover/stretch、裁切都使用同一个布局配置，不另写一套 CSS/PPT 模拟排版。每次只建一个 Konva Group，没有 Stage、事件命中画布或浏览器截图。

```js
const scale = 72 / 96;
const pdf = new Canvas(...pdfPageSize(pages[0]), { gpu: false });
for (const [index, page] of pages.entries()) {
  const context = index ? pdf.newPage(...pdfPageSize(page)) : pdf.getContext("2d");
  // 实际代码在 try/finally 中释放 Group / picture。
  const group = await createPageScene(page, images, decoded);
  const picture = group.toCanvas({
    x: 0, y: 0, width: Math.ceil(page.width), height: Math.ceil(page.height), pixelRatio: 1,
  });
  context.save();
  context.scale(scale, scale);
  context.drawCanvas(picture, 0, 0);
  context.restore();
  group.destroy(); picture.dispose();
}
const bytes = await pdf.toBuffer("pdf");
```

这里必须使用 `drawCanvas` 转移 Skia 记录的绘图指令，而不是把整页编码成 PNG 后 `drawImage`。实际 PDF 检查发现：第一页只包含原始照片一个图像对象，第二页没有图像对象；两页均有可提取文字，说明本测试的文字/形状保留为矢量。不能据此断言今后加入滤镜等所有效果都不会局部栅格化。

图片每个资产只解码一次；各页 Group/picture 用完立即释放，PDF 和解码图片在最终序列化后释放。Skia 仍需保留各页的原生 PDF 记录至编码完成，因此不能宣称内存与页数无关。

实现索引：

| 文件 | 责任 |
| --- | --- |
| `src/lib/creation/contracts/exports.js` | PDF 格式、双类型匹配、版本、MIME、开关、容器签名 |
| `src/lib/creation/exports/pdf-policy.js` | 页面筛选、资源预算、可见资产、CSS px 到 PDF point 换算 |
| `src/lib/creation/exports/raster.js` | 公用场景构造、真实多页 PDF、原生能力探测 |
| `src/lib/creation/exports/layout-child.mjs` | 格式/版本检查、解码预算与实际转换 |
| `src/lib/domain/creation/exports.js` | 准入、固定版本幂等、重试、记录 |
| `src/lib/domain/creation/export-execution.js` | 固定源、可见资产、租约、发布和恢复 |
| `src/lib/domain/creation/export-process.js` | 无凭据子进程与 PDF 探测调用 |
| `src/workers/creation-export-main.mjs` | 独立运行时探测、PDF 版本心跳、串行队列消费 |
| `src/components/creation/ExportDialog.jsx` | 按作品类型选择格式、保存后提交、恢复、下载 |
| `src/app/api/creation/exports/[id]/download/route.js` | `application/pdf` / `.pdf` 的私有下载 |

## 性能与容量边界

Web/API 不导入原生渲染器、不生成 PDF；浏览器只发送已有作品的版本与格式。Skia 4.0.0 仍仅在 `docker/creation-export` 的锁定依赖中，主应用依赖清单未增加 Skia。不能把 Node 原生模块放到前端 bundle 中。

| 资源 | 上限/行为 |
| --- | --- |
| 可见 PDF 页 | 100 页；全隐藏幻灯片明确失败 |
| 单页面积 | `ceil(width) * ceil(height) <= 8,000,000` |
| 累计面积 | 240,000,000，用于限制累计记录和潜在表面开销 |
| 可见文字 | 全文 500,000 UTF-16 单元，表情等可能占多个单元 |
| 结构化源 | 沿用布局 schema：100 页、每页 500 对象、全文 5000 对象等 |
| 图片 | 最多 100 个资产；单个压缩文件 50 MiB，总压缩输入/转换结果各 100 MiB；PDF 累计解码图片 1600 万像素 |
| 输出 | 64 MiB；必须具有 `%PDF-` 开头和末尾 `%%EOF`，该检查不是完整 PDF 解析器 |
| 转换 | 单 Worker 并发 1；子进程最多 120 秒、256 MiB V8 堆、Skia/Sharp 各单线程 |
| 排队 | 沿用全局 50 / 每用户 2 个活动导出，过期心跳拒绝新导出 |

256 MiB 是 V8 堆限制，不能约束全部 Skia/Sharp 原生分配。容器/主机仍必须配置内存、CPU、PID、临时盘和网络边界；独立部署是必要条件。没有运行大样本内存/吞吐或原首页、旧画布、电商 Agent 的生产回归，不能凭该架构宣称性能已达标。

物理尺寸：绘制坐标按 `72/96` 换算；Skia 4 PDF 的页面边界向上取整到整数 point，代码已显式采用此策略。每边物理误差小于 1 point，内容不拉伸。例如 321×481 px 对应 241×361 pt，在 Poppler 96 dpi 渲染后是 322×482 px，有最多约一个像素的空白边，不是完整的像素尺寸恒等输出。

## 部署准入

不更改已有默认开关，需在受限导出部署中显式设置：

1. `CREATION_EXPORT_ISOLATED=true`，按实际配置落实隔离，不仅是设置变量。
2. 使用锁定 Skia 4.0.0 与五个 Noto 字体族的导出镜像。
3. `CREATION_PDF_RUNTIME=true`，启动时真实执行 PNG/JPEG、中文字形绘制、多页 PDF 和 `drawCanvas` 探测，成功才发布 `exporters.pdf = layout-pdf-1`。
4. Web/API 的 `CREATION_LAYOUT_PDF_EXPORT_ENABLED=true` 配合匹配且新鲜的 Worker 心跳，才允许新请求。

`CREATION_RASTER_RUNTIME` 与 `CREATION_PDF_RUNTIME` 独立，旧的 PNG 能力心跳不能替代 PDF 心跳。共用同一个导出队列的消费者必须全部升级为兼容版本并具备所开启格式的运行时；当前全局单条心跳不能保证异构消费者能力路由。不要让未升级实例抢走 PDF 任务。本轮未构建镜像、启动 Worker 或改变任何运行开关。

生产所需字体：Noto Sans、Noto Sans CJK SC、Noto Serif、Noto Serif CJK SC、Noto Sans Mono。任意缺失即启动探测失败，不通过忽略错误或假心跳降级为可用。

## 实际验证与已知缺口

本轮串行运行 **6 个定向文件 / 42 个用例** 最终通过；**17 个触及 JS/JSX/MJS 文件 ESLint** 通过。覆盖 PDF policy、格式隔离、双类型准入、固定版本、独立 Worker 心跳、隐藏/不可见资产排除、全隐藏失败、错误 ZIP 不发布、失联恢复、历史 PDF 重试，以及已有 Office/PPTX/SVG 子进程回归。

额外 native 用例实际加载 Skia 4.0.0、Konva 与 Sharp，输出多页 PDF/海报 PDF；运行真实转换子进程。pypdf 检查页数、顺序、尺寸、文字、照片/字体资源，Poppler 96 dpi 渲染两页并用 Pillow 与 PNG 比较，再人工查看两张预览：

- 第一页：640×360 px，中文标题、英文、半透明旋转矩形、透明 PNG cover 裁切；平均 RGB 绝对差 0.4471/255。
- 第二页：原版 321×481 px，不同尺寸、中文、英文、椭圆；考虑取整空白边后平均差 1.2120/255。
- 未输出隐藏页、不可见图片或演讲备注。海报即使带 hidden 标志仍输出唯一画板。
- 输出目录：`artifacts/creation-workbench-20261024/pdf-export/`；`verification.json` 明确保留 `exact_cjk_roundtrip: false`，没有把中文复制问题藏成测试通过。

**字体边界**：Windows 本机有 Noto Sans SC / Noto Serif SC，与生产族名不同；仅在测试进程注册 CJK 别名，并用 Consolas 代替本机缺失的 Noto Sans Mono。测试转换子进程通过专用测试 preload 注册相同别名，正式 spawn 未加入 preload 或 `NODE_OPTIONS`。无这些别名的正式探测确实以 `EXPORT_FONTS_UNAVAILABLE` 拒绝，已加入断言。此结果验证实际转换代码和失败关闭路径，不能替代 Linux 生产字体镜像的成功验收。

**中文语义边界**：本机可视中文正确，第一页“咖啡开业”可正常提取；第二页“第二页”提取时出现 `二 -> U+2F06`、`页 -> U+2EDA` 等字形反向映射差异。不是文字整体栅格化，也不能宣称全文精准搜索/复制。弹窗和返回 warnings 明确提示该边界。需要后续核对生产静态 Noto CJK 字体，并评估能提供准确 Unicode/ActualText 的 PDF 后端；未宣称问题已经修复。

未验证：真实 PostgreSQL/Outbox/Redis/S3 全链、浏览器实际下载、Linux 字体镜像、Windows/移动设备 PDF 阅读器/打印、可访问性标签、PDF/A/CMYK/出血线、大样本资源隔离与全站性能。没有重新跑完整 Next 页面；本轮没有构建、数据库、迁移、队列 Worker 或付费模型调用。

## 复现

普通定向测试不要求安装 Skia；native 用例通过 `CREATION_NATIVE_RENDER_TESTS=true` 显式开启，缺少渲染器/字体/解析器时应失败，不能当成正常轻量测试的隐式依赖。

```powershell
# 经授权，在已有独立目录按锁文件安装；不修改主应用依赖。
# Set-Location docker/creation-export; npm ci --omit=dev --no-audit --no-fund
# 本机还需 node_modules/skia-canvas 指向该目录的依赖链接。
$env:CREATION_NATIVE_RENDER_TESTS = 'true'
$env:SKIA_CANVAS_THREADS = '1'
# 如 python / pdftoppm 不在 PATH，通过下列变量提供已安装工具的绝对路径：
# CREATION_PDF_TEST_PYTHON / CREATION_PDF_TEST_POPPLER
# 可用 CREATION_PDF_TEST_OUTPUT_DIR 保留测试 PDF/PNG；默认自动清理临时文件。
npx vitest run --project unit --maxWorkers 1 --no-file-parallelism tests/unit/creation-pdf-render.test.mjs tests/unit/creation-pdf.test.mjs tests/unit/creation-export-policy.test.mjs tests/unit/creation-export-workflow.test.mjs tests/unit/creation-export-dialog.test.jsx tests/unit/creation-export-process.test.mjs
```
