# 海报/PPT 主题绑定与画布复用

更新：2026-10-24。状态：已实现并完成限定单测/浏览器验证；功能开关未改变，不代表全平台或生产性能验收完成。

## 用户体验

文字属性新增“文字配色来源”“字体来源”，形状新增填充/描边配色来源，画板新增背景配色来源。颜色可以选择主色、强调色、背景色或自定义；字体可以跟随主题或自定义。选择一个绑定立即应用当前主题对应值。

新文字默认跟随主色和主题字体，新形状默认跟随强调色，透明描边保持自定义，新建幻灯片背景跟随主题背景。复制对象/页面保留来源关系。手动改颜色/字体会把该属性转为自定义，即使手动值恰好等于当前主题色，也不会下次被自动替换。其他属性（字号、几何、文字内容）修改不会解除绑定。

主题中主色与强调色可以先合并为相同值，再拆成不同值；绑定仍然记得每个对象用途。锁定对象保留实际颜色、字体和绑定，切主题不改锁定内容；解锁后明确重新选择来源，或下一次主题变化，才应用新主题。所有操作支持撤销/重做并保存来源关系。

旧作品缺少来源字段时继续使用原颜色匹配规则，遇到有歧义的同色用途保留原值，不擅自迁移成某一种绑定。属性面板标为“自动匹配（原有作品）”。

## 数据、保存与 AI

实际 `fill`/`stroke`/`fontFamily`/`background` 仍是渲染和导出的具体值，来源只控制将来的主题变化。这样 Canvas、缩略图、SVG、光栅导出不需要每帧扫描主题或解析来源。

- 文字：`style.fillRole`、`style.fontRole`。
- 形状：`fillRole`、`strokeRole`。
- 页面：`backgroundRole`。
- 颜色来源限定 `primary | accent | background | custom`，字体来源限定 `theme | custom`。
- 文档字段可缺省但不能为 null；操作补丁允许 null 表示恢复“字段原本不存在”。精确撤销同时保存旧值和旧绑定，不能按当前主题倒推旧值。
- 沿用 `setTextStyle`、`setShapeStyle`、`setPage` 和 CAS 操作日志。全作品主题更新继续用一个有界 `setTheme`，不拆成几千个独立请求。
- 局部操作只复制目标页/目标节点。全主题显式动作最多遍历合同已有的 5,000 个对象；未变化页面保持引用，避免所有缩略图无条件刷新。
- 模型指南说明生成对象要输出来源与具体值，局部修改仍受 pageId/nodeIds 范围约束。模型实际生成质量未实测；新增字段没有放宽 AI 修改范围。

核心实现：`src/lib/creation/layout-theme-bindings.js`、`layout-theme.js`、`layout-operations.js`、`layout-history.js`、`contracts/layout.js`；UI 位于 `src/components/creation/editors/layout/ThemeRoleField.jsx`、`ObjectStyles.jsx`、`LayoutEditor.jsx`。

## PPTX

PPTX theme part 使用作品实际主题名称/主色/强调色/背景色及字体。显式绑定且实际值与当前主题一致的颜色写为 DrawingML `schemeClr`，字体写为 `+mn-lt/+mn-ea/+mn-cs`；自定义、未绑定或锁定导致的旧实际值保持直接格式。透明度保留在使用处；主题色本身写 RGB，避免重复叠加透明度。

本项目的 `primary/accent/background` 映射为 `dk1/accent1/lt1`。这是本项目的主题合同，不是完整 PowerPoint 母版系统。导出的隐藏页、备注、可编辑文本/形状和已有几何保持；没有新增母版、图表/表格对象或字体嵌入。测试验证 ZIP/XML，但没有 PowerPoint/WPS 打开验证。

这次对 layout schema 的可选字段是增量扩展，未做数据迁移或改动当前默认关闭的导出开关；旧严格校验客户端/Worker 不认识这些字段。正式灰度必须同步升级编辑器/API/语言/转换 Worker，不能与旧构建混合消费。现有 `layout-pptx-1` 版本号未拆分，因此不能仅以其心跳作为支持绑定字段的证明；上线前需按完整构建版本/发布批次验收，生产已有历史导出缓存应与转换器升级方案一起处理。

## 画布与性能诊断

30 页、每页 100 对象的样本暴露了切页重复创建 Stage、Layer、尺寸观察器和 canvas 的成本。移除页面 key 对整个 LayoutCanvas 的重挂载，让单个 Stage/Layer/尺寸监听跨页复用；具体页面对象仍按 pageId + nodeId 隔离，避免跨页拖拽/变换状态串用。仅当前页拥有编辑画布，不保留 30 个画布。

切页仍先提交未确认文字。草稿自身保存 pageId，外部页面更换后即使新页存在同名 nodeId，也拒绝把旧稿写进去；草稿日志仍指向原页，可回原页恢复。浏览器检查“第一页改字 → 切第二页 → 保存”，确认只修改第一页。

本机 Next 开发模式、HeadlessChrome 153、1920×1080、模拟 API、无 CPU/网络节流，20 次已加载页面切换及 3 次主题切换。计时从程序触发点击到双 requestAnimationFrame；不是可信输入事件 INP、生产基线、冷加载或服务端吞吐测试。

| 指标 | 修改前 | 画布复用后 |
| --- | --- | --- |
| 切页 p95（20 次） | 75.7ms | 64.6ms |
| 3 次主题操作到双帧 | 70.1–77.9ms | 63.2–72.5ms |
| 观察窗口长任务 | 23 次，55–70ms | 16 次，50–66ms |
| 编辑画布数量 | 1（反复新建） | 1（同一 DOM canvas） |
| 结束时缩略图图片数量 | 2 | 1 |

两次单轮结果只能作为方向性诊断，不能作为统计稳定的性能提升承诺。`performance.memory` 返回约 35.1 MB 的粗粒度值且前后不变，不能据此认定内存无增长/无泄漏。后台压缩、真实图片/长中文段落、低配移动、旧画布/电商并发均未覆盖。

**仍存在 50ms 以上长任务，未满足主计划的常规编辑长任务目标。** 后续开发模式采样已定位一部分对象创建成本，见下节；仍需在授权的生产构建/基准环境确认实际占比与改动收益，不能拿切页 p95 达标代替这一项。

证据：

- [修改前原始记录](../artifacts/creation-workbench-20261024/layout-theme-performance/creation-workspace-30-slid-c32d8-thout-mounting-every-canvas/layout-interaction-metrics.json)。
- [画布复用后原始记录](../artifacts/creation-workbench-20261024/theme-canvas-reuse/creation-workspace-30-slid-c32d8-thout-mounting-every-canvas/layout-interaction-metrics.json)。
- 截图：[主题绑定面板](../artifacts/creation-workbench-20261024/theme-final/creation-workspace-theme-b-e9af9-edits-undo-and-saved-reopen/theme-binding-desktop.png)。

## 本轮验证和未完成项

最终 12 个定向单元文件、63 个不同用例通过；3 个浏览器场景通过（PPT 响应式、主题保存/重开/跨页文字、30 页诊断），跨页文字断言补入后主题场景再跑通过。18 个触及 JS/JSX/MJS 文件 ESLint 最终无警告。首轮新增 PPTX 用例因 XML 命名空间定位方式错误失败，修正测试定位后通过。

未新增依赖、迁移、数据库/队列 Worker、生产构建、付费模型调用或部署；临时开发服务已停止。完整母版、图表/表格、模板覆盖、PDF、真实模型/Office/全站性能验收仍未完成。本里程碑不能代表已经与 Cheso 全面一致。

## 后续：对象创建采样与节点简化

在同一 30 页 × 100 对象场景中，仅为 20 次切页开启 Chromium CPU Profiler。累积调用栈采样中 LayoutNode 约 502ms（其中 JSX 开发期创建约 464ms），LayoutEditor 约 151ms，LayoutCanvas 约 58ms；缩略图渲染约 96ms，草稿 recordFor 约 26ms。这些是整个采样窗口的包含子调用时间，调用栈可能重叠，不能相加成为总耗时，也不是每次交互耗时。开发模式 JSX 检查占比很大，不能据此推断生产收益。

原始证据：[CPU profile](../artifacts/creation-workbench-20261024/layout-profile-before/creation-workspace-30-slid-c32d8-thout-mounting-every-canvas/layout-page-switch.cpuprofile)。在原场景增加 `CREATION_UI_PROFILE=true` 可选择记录；普通交互计时不启用 Profiler，输出指标带 `profiled` 标记以免混用。

对应改动：

- `LayoutCanvas.jsx`：文字与矩形从 Group + 透明命中 Rect + 绘制节点变为单个原生 Text/Rect。自定义 hitFunc 保留整个对象矩形的选中范围，包括文字留白和透明圆角矩形内部；拖动、变换与操作日志合同保持。图片、椭圆与线条仍保留各自局部几何容器。
- `LayoutEditor.jsx`：图层列表收起时不生成对象按钮；打开后按当前页重建，保留选择状态。切页仍只使用一个 Canvas。

完整 Next 开发服务在后续重编译时产生严重内存压力，多次停在编译页面。尝试禁用开发缓存无改善，该临时配置已移除。未把导航超时记录当成产品交互失败或性能数据，也没有继续重复启动。**本轮没有可与前表直接比较的优化后整页数据。**

为验证渲染重构，新增短生命周期的 Vite 组件浏览器夹具，复用已安装的 Vite 8.3.0，未安装 esbuild 或新增依赖。实际挂载 LayoutCanvas、ObjectStyles、schema 与撤销逻辑；只有样例工具栏/页面切换，未加载 Next shell、保存服务、数据库或模型。服务器仅监听回环地址，测试拦截外部请求，结束自动关闭。

运行：`node node_modules/@playwright/test/cli.js test --config playwright.creation-canvas.config.mjs`。

最终 **2 个组件浏览器场景通过**：文字留白选中/拖动/缩放/撤销，透明矩形拖动/锁定/旋转，椭圆拖动、线条选中；编辑文字后切到同 nodeId 的第二页仅修改原页，Canvas DOM 复用，只读禁止编辑与拖动。坐标按浏览器实际整数像素输入换算，避免缩放后小数坐标取整误差。没有控制台或页面错误；人工检查了[交互截图](../artifacts/creation-workbench-20261024/canvas-component/creation-canvas-real-Konva-8cf7d-size-rotation-lock-and-undo/canvas-gestures.png)。这张图是组件测试页，**不是最终工作台外观**。

相关 10 个单元文件共 52 个不同用例最终通过；新图层用例初始 fixture 缺少必填主题，补齐后通过，其余 51 个用例首轮通过。覆盖文字草稿、保存协调、操作历史、主题绑定、演示与缩略图队列，新增图层收起/展开及跨页选择行为。7 个触及代码/测试/配置文件 ESLint 通过，无警告。完整工作台新增鼠标手势场景仍待资源充足时运行，组件结果不能替代整站保存、加载或性能验收。
