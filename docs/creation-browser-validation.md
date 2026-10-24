# AI 创作工作台：首轮浏览器验证

日期：2026-10-24。状态：开发中，完成以下限定范围的验证，不代表整体交付或生产性能验收。

## 环境与范围

- Windows 本机，Next.js 16.3.4 开发服务，Turbopack 按需编译，监听 `127.0.0.1:3101`；未进行生产构建。
- 用户本轮明确许可本地服务和页面验证。串行运行，Playwright 单 Worker；没有启动数据库、队列 Worker、应用迁移或调用付费模型。
- API 全部由浏览器测试拦截，使用虚构账号、小型 PPT、原生文档与原生表格。浏览器外部 HTTP 请求阻止，开发服务数据库地址覆盖为不可连接的本机测试地址。
- 实际加载 React、Konva、Univer 1.2.0、公式 Web Worker、浏览器 IndexedDB、CSS 和字体。API 拦截成功不等于后台任务、账本、数据库或云端保存已经验证。
- 本轮结束已停止临时开发服务并确认 3101 端口不再监听；测试代码和截图保留，可在获准的验证环境复跑。

## 实际检查结果

| 场景 | 验证内容 | 结果 |
| --- | --- | --- |
| 首页选择 PPT | 显示按类型变化的输入；点击类型没有创建项目、读取作品正文或请求可识别的 Univer/编辑器脚本 | 通过。开发模式的脚本 URL 检查不能替代生产 bundle 分析 |
| PPT 工作台 | 1440、1024、390 像素；聊天分栏键盘调宽；文件搜索/清空；搜索期间画布保持挂载；手机对话/作品切换 | 通过；检查画布尺寸、页面横向溢出并查看截图 |
| 原生文档 | 等待真实工具栏出现、骨架消失；正文渲染；中文文本输入；显式保存为 V2；返回首页 | 通过。不是操作系统中文输入法组合输入验收 |
| 原生表格 | 网格和 SUM 公式渲染；观察超过完整 5 秒自动保存间隔；F2 编辑 B2，Enter 确认，保存 V2 | 通过。保存请求中 B2=4200，B4 的 `=SUM(B2:B3)` 保留；无操作打开期间没有 PUT |
| 编辑器退出 | 站内导航回首页，编辑器不可见，原首页输入区完整显示；统计公式 Worker 创建/终止次数 | 通过；公式 Worker 数量归零，浏览器无 React 同步卸载警告 |

这里“保存通过”指真实输入、编辑器快照、IndexedDB 日志和前端保存请求/确认链，通过测试 API 返回的 CAS 响应；没有真实数据库写入。

## 浏览器检查发现并修复的问题

1. `/creation` 未加入公共 Navbar 的排除列表，导致工作台出现两套顶部导航。只补充该路径，继续使用原站 CreativeShell 与品牌。
2. 画布属性栏按整个窗口宽度排版，聊天分栏和文件列表会挤占画布。现在根据作品区宽度切换布局，不用 React 在每个拖动帧重新布局；手机默认折叠文件列表，仍可手动展开搜索和切文件。
3. 文件列表原来把文档、表格、网页都画成图片图标。现在区分类型并展示版本，增加按提交触发的项目级名称搜索。服务端每页只取 25 条元数据用于返回 24 条；游标绑定项目和规范化查询，保留旧无搜索游标兼容。返回条数有界不代表数据库扫描成本有严格上界，正式环境仍需用真实规模检查查询计划。
4. 搜索或翻页被 Activity 中断后，旧 loading 状态可能保留。重新连接时清理中断状态，旧请求不能覆盖新页面；失败可以重试原查询，而非未提交的新输入。
5. Univer 把公式启动/进度等通讯消息也标记为 mutation，原保存监听器因此把“打开文件”识别为修改。现在只忽略已核对的 1.2.0 通知，以及带明确标记的跨线程计算缓存回写；用户内容/格式/公式修改继续计入。缓存保留在运行实例中，并随下一次实际修改的快照保存，未转回简化表格格式。
6. Univer 的独立 React root 在父 React effect 清理中同步卸载，浏览器会报警。每个实例现在拥有独立内部容器；立即停止监听、订阅与 Worker，移除旧容器，随后一个 microtask 中完成库的释放。新实例不会被旧实例的延迟清理移除；即使一项释放抛错，其余释放仍会执行。

## 检查记录与入口

- 本轮涉及的 **6 个定向单元测试文件、47 个不同用例**最终通过。针对修改/失败的文件重跑；计数不重复累计。
- **4 个浏览器场景**最终通过；原生 Office 场景还验证输入保存和离开页面。测试在首轮失败后修复了测试数据缺项、键盘输入定位和上述真实问题，未隐藏控制台错误。
- **11 个触及 JS/JSX/MJS 文件**的限定 ESLint 通过；工作台 CSS 使用 PostCSS 成功解析。
- 浏览器配置：`playwright.creation-dev.config.mjs`。配置只连接已有服务，不自行启动服务或基础设施。
- 用例：`tests/ui/creation-workspace.spec.mjs`。运行命令：`node node_modules/@playwright/test/cli.js test --config playwright.creation-dev.config.mjs`。
- 核心修复：`src/lib/creation/client/native-office-engine.js`、`src/components/creation/CreationWorkspace.jsx`、`src/components/creation/ProjectFiles.jsx`、`src/lib/domain/creation/project-files.js`。

## 第二轮：历史导航、重新打开与真实保存格式

同日继续使用上述授权与隔离服务。最终 **8 个定向单元文件、86 个不同用例；5 个浏览器场景；11 个触及 JS/JSX/MJS 文件 ESLint 全部通过**。本轮开发服务已停止，3101 无监听。没有构建、数据库/队列 Worker、迁移、付费调用或开关变更。

- 文档通过项目列表进入工作台，编辑后触发后退：延迟保存时地址/历史 entry 不变；模拟一次 503 后留在原编辑页并解锁；再次后退、连续后退只进行一次重试。保存后跳到原定 entry，历史 key 列表保持不变。前进重新打开 V2，第二次修改后前进触发保存，再次后退重开 V3。
- 文档和表格均验证显式保存 V2 → 首页 → 浏览器后退 → 真实引擎重新打开。表格 F2 未确认输入时前进被阻止，Enter 后通过浏览器历史控件前进成功；两次实例生命周期的公式 Worker 均终止。
- 表格场景使用 Playwright `goForward`（浏览器历史控件）验证确认输入后的前进；本机 Chromium 的连续脚本 `history.forward()` 在该键盘场景曾没有发出第二个顶层 navigate 事件，原因未确定，不能将其写成已解决的浏览器脚本行为。文档场景仍覆盖连续 `history.back()`、`history.forward()`；Firefox/WebKit 与移动端手势未测。
- 首次重开发现默认 preset 资源被拒绝。核对 1.2.0 `DocumentPermissionRuleModel`、`ObjectPermissionRuleModel` 与授权 mock service 的保存代码，添加文档空权限数组、表格空授权对象的精确兼容。非空数据不删除、不忽略，仍明确拒绝。对应两个真实浏览器 fixture 同时验证 DOCX/XLSX XML，不能代替 Word/Excel/WPS 打开验收。
- 导航的单元用例覆盖首次目的地优先、异步重放错误、同 URL 的 entry 更换、卸载取消、监听清理、单次 bypass 以及保存失败的输入焦点恢复。普通页面不挂导航监听，不增加快照序列化或轮询；生产包与内存/交互基线仍未测量。
- 历史保存屏障仅适用于 **支持 Navigation API、可取消的同文档 traversal**。跨文档、旧浏览器、刷新/关页依赖已有 beforeunload/本地日志，没有异步云保存必达保证。当前功能开关仍关闭，兼容性边界必须纳入上线验收。

测试样本：`tests/fixtures/creation-native-document-browser.json`、`tests/fixtures/creation-native-sheet-browser.json`，从本机虚构项目的保存请求提取，不含用户内容或凭据。

第二轮截图：[历史导航等待保存](../artifacts/creation-workbench-20261024/history-saving.png)、[保存失败留在编辑页](../artifacts/creation-workbench-20261024/history-save-failed.png)。

## 第三轮：Office 参考附件

- 单个串行浏览器用例检查 1440×960 与 390×900 的工作台，采用实际 DOCX ZIP 测试文件和模拟 API。上传 multipart 中原始文件字节保持一致；选中后显示中文名/类型/下载入口；移除引用后可从已上传列表重新引用，不再 POST 上传。提交消息包含 `referenceIds: ["brief"]`，请求成功后清空输入。
- 页面无横向溢出，无控制台错误；Office 解析代码没有出现在该页面的脚本请求中。人工检查两张截图，桌面附件保留在对话输入区、手机可切换到对话操作。测试数据不代表模型生成结果，脚本请求检查不是生产 bundle 或交互性能测量。
- 原件下载点击在本机 Chromium 绕过 Playwright 页面/上下文路由拦截，命中无数据库的开发 API，返回 500 后取消下载。没有修改产品下载实现来迎合测试。最终页面用例仅验证 `href` 与 `download` 属性，真实下载仍待真实后台验收；路由单测验证鉴权、字节/校验和及 attachment 响应头。开发数据库地址固定为不可达本机端口，未连接实际数据库。
- 最终 **1 个浏览器组合场景通过**；相关 **15 文件/73 单元用例、34 文件 ESLint**通过。未重复运行既已通过且无改动的所有浏览器场景。服务已停止，3101 无监听。
- 用例筛选：`node node_modules/@playwright/test/cli.js test --config playwright.creation-dev.config.mjs --grep 'Office references'`。
- 截图：[桌面附件](../artifacts/creation-workbench-20261024/office-reference-final/creation-workspace-Office--99569-eused-on-desktop-and-mobile/office-reference-desktop.png)、[手机附件](../artifacts/creation-workbench-20261024/office-reference-final/creation-workspace-Office--99569-eused-on-desktop-and-mobile/office-reference-mobile.png)。实现说明：[Office 参考资料](creation-office-references.md)。

## 第四轮：主题来源、保存重开与 30 页诊断

新增主题来源操作场景：文字绑定强调色 → 切换主题 → 手动改色成为自定义 → 再切换主题保持自定义 → 撤销/重做 → 保存 → reload 读取 → 重新绑定主色。模拟保存接口执行真实 schema/操作校验。随后双击画布文字编辑第一页面，切换同对象 ID 的第二页，保存内容只影响原页。真实 Konva/IndexedDB 与页面事件参与，数据库为替身。

30 页×100 对象诊断使用固定 fixture、20 次切页和 3 次主题操作，只挂一个编辑 canvas，缩略图保持按需加载。先观察到重复 canvas 重建，修复后验证同一 canvas DOM 跨页复用。开发模式切页 p95 75.7ms → 64.6ms，长任务 23 → 16 次，仍有 50–66ms 长任务，**未通过生产性能验收**。测量含开发框架开销、无节流，程序点击到双帧不是 INP；详细边界、原始记录见 [实现与性能诊断](creation-layout-theme-bindings.md)。

最终 3 个相关浏览器场景通过，包括旧 PPT 响应式布局。新增文字跨页断言后该场景再次通过；不重复累计用例。12 文件/63 单元测试、18 文件 ESLint 通过。未调用模型、启动数据库/队列 Worker、生产构建或更改开关；临时服务已停止。

截图：[主题来源属性面板](../artifacts/creation-workbench-20261024/theme-final/creation-workspace-theme-b-e9af9-edits-undo-and-saved-reopen/theme-binding-desktop.png)。

## 第五轮：轻量画布组件回归与性能采样

完整 Next 开发页成功完成一次切页 CPU profile，随后重编译出现内存压力/导航超时；停止完整服务并移除无效的缓存诊断配置。失败记录未计入交互性能数据，未宣称完整工作台新增手势用例通过。

使用已安装的 Vite 启动仅包含真实 Canvas/属性面板/操作历史的本机测试页，串行完成 **2 个浏览器场景**：文字与透明矩形的命中、拖动、缩放/旋转、锁定和撤销，椭圆/线条选择，以及同 nodeId 跨页文字隔离、Canvas DOM 复用与只读限制。没有 Next shell、业务保存服务或真实后台；不能用这份结果替代整站验收。相关 **10 文件/52 个单元用例**最终通过。

运行：`node node_modules/@playwright/test/cli.js test --config playwright.creation-canvas.config.mjs`。本机服务随测试结束关闭，禁止夹具访问外部网络；无依赖安装、数据库/队列 Worker、生产构建或模型调用。采样分析、实现与截图见[节点简化记录](creation-layout-theme-bindings.md#后续对象创建采样与节点简化)。未获得同环境的优化后整页时延，因此本轮不报告性能提升百分比。

## 第六轮：空间利用率与网页编辑

2026-10-25。工作台铺满可用区域，桌面导航缩为 56px 图标栏，顶部栏 48px；单作品默认收起文件树及布局属性栏。输入框随内容增长到上限，参考素材和参数折叠，减少对历史记录的挤占。画布局部工具在宽屏占独立 288px 侧栏，画布适配真实剩余区域；窄屏限制工具高度。上述样式限定在对应工作台，首页不加载 Office 或导出运行时。

网页固定所选 CSS 视口再按容器缩放；打开、关闭属性栏不会重新生成 srcDoc 或丢失修改草稿。网页选择文字、改字、保存以及 1440/1024/390 像素无横向溢出的组合场景通过；预览 sandbox 仍不允许脚本。最新 PPT 多尺寸场景通过；此前画布密度三个场景验证真实 Konva、绘制遮罩和提交请求。API 均为替身，没有真实模型/数据库/队列验证。

最新网页和 PPT 共两个浏览器场景通过；网页及 Office 样式四文件 31 单元用例通过，33 个相关源文件 ESLint 通过。早前 30 页开发诊断只能说明固定夹具下的交互情况，不能代表生产性能。保留可复查的截图：

- [PPT 桌面](../artifacts/creation-workbench-20261025/workspace-density/creation-workspace-PPT-wor-43f19-able-files-and-mobile-views/workspace-1440.png)
- [网页桌面](../artifacts/creation-workbench-20261025/workspace-density/creation-workspace-inert-w-2faa5--through-inspector-resizing/web-fit-1440.png)
- [网页手机](../artifacts/creation-workbench-20261025/workspace-density/creation-workspace-inert-w-2faa5--through-inspector-resizing/web-fit-390.png)
- [画布局部修改](../artifacts/creation-workbench-20261025/canvas-density/parity-tools-workspace-den-022b8-d-painting-usable-at-1440px/local-edit-1440.png)

以上是当前实现的密度调整，尚未完成全站逐屏检查或全面 Cheso 视觉对照，不代表整体开发完成。

## 截图

截图均为真实开发页面和模拟业务内容；不是 Cheso 截图，也不代表模型实际生成质量。开发模式角落的 Next.js 指示器不是产品功能。

- [首页选择 PPT](../artifacts/creation-workbench-20261024/home-ppt-selected.png)
- [PPT 桌面](../artifacts/creation-workbench-20261024/workspace-1440.png)
- [聊天栏调宽](../artifacts/creation-workbench-20261024/workspace-chat-expanded.png)
- [PPT 1024 像素](../artifacts/creation-workbench-20261024/workspace-1024.png)
- [PPT 手机](../artifacts/creation-workbench-20261024/workspace-390.png)
- [原生文档](../artifacts/creation-workbench-20261024/native-document.png)
- [原生表格](../artifacts/creation-workbench-20261024/native-sheet.png)
- [文档退出后的首页](../artifacts/creation-workbench-20261024/home-after-document.png)
- [表格退出后的首页](../artifacts/creation-workbench-20261024/home-after-sheet.png)

## 尚未验收

生产 bundle 大小与首屏延迟、低配设备长任务/内存、反复切页压力、100 页 PPT/大型文档/复杂公式、真实模型任务、实际积分结算、Office 文件兼容性、完整深色主题/移动端 Office、浏览器原生前进后退保护、操作系统 IME、多标签冲突及真实服务断线恢复。旧画布与电商 Agent 的真实性能回归也仍需单独执行。不能据本轮结果承诺“网站不会变卡”或“已经与 Cheso 一模一样”。
