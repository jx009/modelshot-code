# 海报 AI 配图与排版

2026-10-25。源码已接入，默认能力仍由开关、模型配置与 Worker 心跳共同控制；没有进行付费模型或数据库联调。

## 用户操作与服务端执行

首页和工作台的海报输入区可选择 AI 配图。报价使用当前图片模型对应尺寸的真实价格，宽高比映射到 1024×1024、1024×1536 或 1536×1024。界面合计图片与语言费用，提交原始报价、模型和预算；服务端重新核价，不信任客户端价格。只生成排版时不新增图片步骤。

选择配图时创建 `poster.image → poster.generate` 两步。图片步骤复用 Studio 图片作业、账本和 Outbox；语言步骤取得实际资产后生成可编辑对象。浏览器负责观察，调度与发布不依赖页面持续打开。

`publishPosterImage()` 在 Run 锁和事务内校验用户、项目、作业、步骤、尝试次数和资产归属，持久化素材引用后才释放排版步骤。重放不能再次调用图片模型。取消后迟到的图片不能把排版重新解锁；重试排版保留已成功配图，避免重复付费。

海报结果必须含实际配图资产的可见对象，透明度大于零，并与画板有正面积交集。采用考虑旋转的矩形分离轴检查，拒绝只碰边、完全在画板外或旋转后实际不可见的对象。该检查不等于视觉质量评审。

## 关键源码

- `src/lib/creation/contracts/poster-image.js`：输入、尺寸和工具契约。
- `src/lib/domain/creation/content-runs.js`：预算、准入、恢复和保留成功步骤。
- `src/lib/domain/creation/scheduler.js`：提交图片作业、推进依赖。
- `src/lib/domain/creation/poster-images.js`：核价及原子发布。
- `src/lib/domain/studio/jobs.js`：仅允许已锁定的服务端海报步骤使用无画布图片入口；公开 Studio 接口继续检查画布归属。
- `src/lib/creation/contracts/language.js`、`layout-geometry.js`：结果引用和可见交集校验。
- `CreationLauncher.jsx`、`CreationWorkspace.jsx`：参数、报价及丢响应恢复。

## 部署与验证边界

调度器与语言 Worker 分别公布 `creation-poster-image-scheduler-v1`、`creation-poster-image-language-v1`，版本均为 1。旧 Worker 的普通心跳不能使新链路通过准入。还需既有图片 Worker、模型通道、队列和账本可用；本文不表示这些服务已启动。

定向替身覆盖报价变化、预算、来源身份、资产绑定、取消和恢复。海报/语言/布局三个测试文件 38 用例通过。真实环境仍需验证：配图成功而排版失败后的重试、提交响应丢失、页面关闭、重复队列唤醒、取消迟到结果、费用结算与最终视觉。
