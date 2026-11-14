> 已归档：本文为历史过程记录，结论可能已过时。现行方案见 `docs/frontend-redesign-spec-2026-11.md` 与 `docs/product-refocus-plan-2026-11.md`。

# 创作工作台交付与联调说明

2026-10-25；本轮基于 `9f1a3eb`。完整范围以 [Cheso 对标方案](cheso-alignment-remaining-plan.md) 为准。源码、局部验证和真实环境验收分别记录，不把 API 夹具当作模型生成结果。

## 功能入口和当前实现

保留首页图片创作、原无限画布、电商 Agent 和视频工具。海报、PPT、文档、表格、网页进入 `/zh/creation?project=<项目ID>`，复用账号、素材、计费及持久化任务。

| 能力 | 当前实现 | 本机证据 |
|---|---|---|
| 海报 | HTML/CSS 自由排版；可选模型配图；DOM 文字/图片/样式编辑、选区 AI、版本/CAS、撤销；PNG/JPEG/PDF | 实际 DOM 编辑→保存→刷新；真实 Chromium 转换子进程；五种视口截图。内容为夹具，未调用付费模型 |
| PPT | 每页 HTML；大纲确认、逐页生成、主题/共享母版、备注/排序/隐藏/演示；表格/图表；PPTX 导入及可编辑导出 | 表格合并/图表缓存解析、字号/粗体/对齐；实际 HTML→PPTX 文本/合并表格/图表；30 页单 iframe 检查 |
| 服务端 Agent | 有界工具规划、依赖 DAG、计划/预算确认、资料读取、图片生成、跨类型创建/修改、导出；父子任务持久关联 | 规划校验、幂等、固定版本依赖、成本只计一次、大纲等待、取消传播、导出事务绑定 |
| 文档 | Univer 1.2.0、分节生成、选区 AI；DOCX 原包导入/投影/范围回写；DOCX/Markdown/PDF | 实际 DOCX/Univer 保存/范围回写，未修改 XML 保留；转换子进程；编辑器页面 |
| 表格 | Univer、XLSX 原包导入/回写、公式 Worker、选区 AI、XLSX；多表或超过 25 行时分块生成 | XLSX/Univer 往返、保护单元格、25 行边界/稳定地址 ID/组装/重试；实际编辑器启动 |
| 网页 | 多文件源码/可视修改、JS 选区 AI；独立交互预览、本地 ES 模块、SVG、多页链接；ZIP/发布/撤回/回滚 | Chromium 实际模块及按钮交互、父窗口/网络隔离；两版本生命周期和路径重写使用存储/数据库替身 |

新海报不使用固定模板选择器；旧对象 JSON 作品继续兼容。网页是静态站点，不运行生成的服务端程序。

## 本轮核心代码

- `src/lib/creation/contracts/agent.js`：最多 16 步，注册工具和类型化输入；编辑限定在用户选择的文件/版本/范围。不能让模型指定任意价格或执行代码。
- `src/lib/domain/creation/agent-runs.js`：规划→确认→依赖执行；子 Run 与父 Step 在创建事务里双向绑定。父预算汇总子任务实际成本差额，不重复扣费。
- `agent-links.js`：相同用户/项目/会话及双向关联校验，子任务确认/恢复后唤醒父任务。取消子任务结束父计划，避免无法恢复的假重试。
- `dependency-context.js`：语言 Worker 读取固定版本、验证归属和校验和、截取有界文本；正文不进入浏览器 Run 状态。
- `contracts/sheet-batch.js`、`sheet-generation-policy.js`、`domain/creation/publication.js`：表头规划→25 行/最多 500 单元格的块→串行组装，已成功块不重跑。最多 5 表、每表 500 行/20 列，作品正文仍受 2 MiB 限制。
- `web-modules.js`：Acorn 8.16.0 解析 import/export 源范围；预览使用稳定模块 ID 和 data URL，支持循环依赖；ZIP/发布/重命名共用路径规则。不在首页提前挂载编辑器。
- `web-runtime.js`、`InteractiveWebFrame.jsx`：独立来源、opaque sandbox、一次性握手、来源/窗口/字段/大小校验；卸载清理请求和监听。
- `public-resource-cache.js`：不可变字节缓存 32 MiB/64 项/60 秒、读取并发 2、待处理上限 32、在途合并；撤回/授权仍逐请求检查。
- `office/protection.js`：段落区间索引替代每段遍历全部文字 run；10,000 段用例验证跨段裁剪和局部范围。
- `export-process.js`：取消/超时回收 Node 和 Chromium 进程树；转换放独立 Worker/子进程。
- `CreationWorkspace.jsx`、`html-editor.css`、`ToolPanel.jsx`：全高作品区、紧凑输入、参数折叠、可收起对话/属性/局部修改侧栏、手机和低高度单行工具栏。

## 已执行验证

最后一组串行定向回归：**26 文件、208 测试通过**，包含 Agent、依赖发布、分块表格、Office、网页、编辑器和导出。设置 `CREATION_HTML_RENDER_TESTS=true`，实际 Chromium 导出用例没有跳过。改动生产 JS/JSX/MJS 的限定 ESLint 通过。随后导航保存保护 4 文件/45 项通过；提交审阅补充 Agent 恢复准入与依赖数量限制后，Agent 14 项再次通过。

最新浏览器 4 项通过：HTML 海报编辑保存/重开、首页延迟加载、网页视口/草稿、30 页 HTML PPT；业务 API 为夹具。此前另有 PPT、Office、网页 6 项页面验证通过，覆盖重叠不累计宣传。独立来源网页运行 1 项通过，实际本地模块、中文输入、按钮、多页导航和 CSP，外部 fetch 未发出。

HTML PPT 诊断：本机 Next 开发模式、Chromium、模拟业务接口、无 CPU/网络节流；30 页/每页 101 对象，29 次切页中位数 **48.8ms**、p95 **51.8ms**。切页和 10 次收放对话后，GC 检查前后均为 **3 documents / 1896 nodes / 802 listeners**；只挂载 1 个编辑 iframe。这不是生产 INP、低配基线或全面无泄漏证明。

串行复现：

```powershell
node node_modules/vitest/vitest.mjs run --project unit --no-file-parallelism --maxWorkers=1 tests/unit/creation-agent.test.mjs tests/unit/creation-sheet-workflow.test.mjs tests/unit/creation-office-import.test.mjs tests/unit/creation-resource-cache.test.mjs tests/unit/creation-pptx.test.mjs tests/unit/creation-web-modules.test.mjs
$env:CREATION_HTML_RENDER_TESTS='true'
node node_modules/vitest/vitest.mjs run --project unit --maxWorkers=1 tests/unit/creation-html-render.test.mjs tests/unit/creation-export-process.test.mjs
node node_modules/@playwright/test/cli.js test --config tests/creation-web-runtime.config.mjs
# 已启动本地开发服务时，默认 http://localhost:3117
node node_modules/@playwright/test/cli.js test --config tests/creation-workspace-dev.config.mjs --grep 'HTML poster|HTML slides|home type selection|website preview'
```

本地证据（生成文件不提交）：`test-results-creation-workspace/creation-workspace-HTML-po-f8807-oads-and-keeps-source-clean/` 的五张 `html-poster-宽x高.png`；`creation-workspace-HTML-sl-edd39--and-repeated-panel-changes/html-slide-metrics.json`；真实导出样本 `artifacts/creation-html-export/`。

## 启用顺序与配置

本轮没有生产构建、迁移、数据库/队列启动、付费调用或部署。本地开发服务仅用于页面测试。下面是联调部署步骤，**不是已经执行的操作**：

1. 按锁文件安装主应用依赖、生成 Prisma client；备份后应用仓库现有创作迁移。此次 Agent/分块表格复用 Run/Step JSON，不新增表。
2. 同版本部署 Web、现有图片 Worker、创作调度与语言 Worker。两者一起升级：**Agent pipeline v1，Sheet pipeline v3**；旧心跳不接新协议任务。
3. 使用 `Dockerfile.creation-export` / `compose.creation-export.yaml` 的独立限额容器。锁定 Skia/Playwright/字体；探针成功才宣告 HTML 转换能力。导入/导出并发固定 1。
4. 管理后台配置语言/图片通道及价格，配置存储/Redis/数据库/独立域名，再开能力。缺少必要服务时入口不可用，不模拟成功。

```dotenv
CREATION_WORKSPACE_ENABLED=true
CREATION_RUNS_ENABLED=true
CREATION_POSTER_ENABLED=true
CREATION_SLIDES_ENABLED=true
CREATION_DOCUMENT_ENABLED=true
CREATION_SHEET_ENABLED=true
CREATION_WEB_ENABLED=true
CREATION_NATIVE_OFFICE_ENABLED=true
CREATION_AGENT_ENABLED=true
CREATION_SCHEDULER_CONCURRENCY=1
CREATION_LANGUAGE_CONCURRENCY=1
# 仅独立转换容器：
CREATION_EXPORT_ISOLATED=true
CREATION_HTML_RUNTIME=true
CREATION_RASTER_RUNTIME=true
CREATION_PDF_RUNTIME=true
CREATION_PUBLICATION_ORIGIN=https://preview.example.net
```

命令：`npm run worker:creation`、`npm run worker:creation-language`，独立容器内 `npm run worker:creation-export`。Office 参考附件另需 `CREATION_OFFICE_REFERENCES_ENABLED=true` 和隔离语言 Worker 的 `CREATION_REFERENCE_ISOLATED=true`；不要在 Web 容器中假设隔离。

观察 ServiceHeartbeat、Run/Step 的 status/errorCode/nextCheckAt、Outbox 积压与 Worker 日志。明确失败才重试；付费结果未知先对账。关闭 Agent 开关阻止新准入，不删除历史任务/产物，保留现有 Worker 结果恢复能力。

代理/Cookie/CSP：[网页运行和发布](creation-web-runtime-publication.md)。转换及字体：[原生 Office 导出](creation-native-office-export.md)、[文档 PDF](creation-document-pdf-export.md)。

## 可复现联调用例

1. 海报：“咖啡店 11 月 1 日开业，墨绿和米白，竖版”；生成后双击日期，引用日期说“改为 11 月 8 日，其他内容不变”，保存/刷新/PNG/PDF。
2. 工作台展开“素材与参数”，点击“多步创作”，上传资料，输入“读取资料，制作海报和配套 10 页 PPT，再导出 PDF”；确认计划/预算及 PPT 大纲；关闭浏览器，检查服务端继续、重开恢复。
3. 导入中文 DOCX/XLSX，修改普通段落/单元格后导出，检查未改页眉/其他工作表/图表；受保护区域应报限制，不静默丢失。
4. 多表/超过 25 行的工作簿，检查分块进度；令一块失败后重试，已成功块不重复调用/收费。
5. 网页含首页/子页/CSS/图片/两个本地 JS 模块；运行→发布两版→访问固定旧版→回滚→撤回，撤回后所有历史地址不可访问。

真实环境还应验证 Worker 重启、Redis 断连/重复消息、取消迟到结果、响应丢失后的对账，以及原画布/电商/视频回归。

## 明确限制与未通过的原方案验收

- 复杂 PPTX 组合对象、母版继承、特效仍可能简化；原文件保留并提示限制。HTML→PPTX 对 SVG/复杂 CSS 有降级清单；未取得 Office/WPS 客户端全面往返证据。
- DOCX 修订/域等复杂段落、XLSX 富文本/外链/部分公式和保护区域以原包保留、受保护投影处理，不宣称任意范围可编辑。
- 尚未实现 10 万非空单元格的可视区域流式后端；完整作品仍受 2 MiB 限制。5 表/10 万规模目标没有验收。
- Agent 为有界 DAG；自动失败重规划、直接编辑生成的计划尚未实现。当前支持确认、等待、取消、显式重试和新任务。
- HTML PPT 当前页面完整可编辑，页面导航为轻量标题列表，尚无全部页面缓存缩略图。网页外部包/CDN、动态 import 和服务端 API 不属于当前运行能力。
- 生产构建/bundle、Linux 字体、低配设备、旧站同条件五轮性能基线未完成。局部截图和诊断不能证明整个网站绝不变慢。

这些限制没有标成“全面严格一比一完成”。实现和定向验证可交付，未通过项继续记录在 [验收清单](creation-remaining-work.md)。
