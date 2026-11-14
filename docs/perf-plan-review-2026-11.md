# 性能与改造方案审查（2026-11）

审查对象：

- `docs/product-refocus-plan-2026-11.md`（产品收敛与性能）
- `docs/frontend-redesign-spec-2026-11.md`（前端重做）
- 仓库里三份历史性能文档（`docs/archive/OPTIMIZATION_PLAN.md`、`docs/archive/PERFORMANCE_OPTIMIZATION.md`、`docs/archive/PERFORMANCE_FIX_SUMMARY.md`）

结论：**方向是对的，但漏掉了收益最大的一层——"内容送达用户"**。设计系统和画布优化解决的是"页面好不好看、交互顺不顺"，而当前线上首页首字节要 7.9 秒、连接 60 秒不结束。这一层不修，前面所有工作都会被网络等待吃掉。

另外发现 6 处方案里已经过时或与现状矛盾的内容，需一并修正。

---

## 一、实测证据

以下数据来自本机（中国网络）直接访问线上站点，以及静态阅读代码。

| 项目 | 实测结果 | 说明 |
| --- | --- | --- |
| `https://www.letaidraw.com/zh` 首字节 | **7.90s** | 已命中 ISR 缓存（`x-nextjs-cache: HIT`），慢在链路上，不在渲染 |
| 同一请求完整耗时 | **60.01s（触发 curl 超时）** | 32KB 内容早已下载完，连接不结束，需排查 |
| 响应压缩 | 已开启 gzip | 早先测量时 curl 未带 `Accept-Encoding`，误判为未压缩；2026-11-14 复测确认 HTML 已 gzip |
| `/api/inspiration` | 首次 8.4s / 120KB，再次 24.2s | `Cache-Control: no-store`，每次访问都回源 |
| `src/lib`、`src/app` 中服务端缓存用法 | **0 处** `unstable_cache` / `use cache` | 所有数据请求都实时查库 |
| 客户端组件 | 194 个文件带 `"use client"` | 客户端边界偏大 |
| `next.config.js` 的分包配置 | 自定义 `webpack()` + `splitChunks` | Next 16 默认 Turbopack 构建，文档明确"存在自定义 webpack 配置时构建会失败"，需在 CI 确认实际是否生效 |
| React Compiler | 未安装、未启用 | 项目里手工 memo 密集，是现成的优化杠杆 |
| 图片直出 | 组件内 37 处 `unoptimized` | 作品墙计划用 1024–2048px 原图，会显著拖慢首屏 |
| `src` 下 CSS 总量 | 约 469KB，其中 `globals.css` 70KB | 拆分收益中等，优先级低于交付层 |
| `.next` 目录 | 3.3GB | 本地构建缓存，提示构建产物偏大 |

网络测量受本机网络影响，绝对值会有波动，但**量级差距**（7.9s 对 200ms 级别）足以说明问题。建议在 CI 或第三方测速平台复核一次。

---

## 二、八项升级

### U1（最高优先级）补上"交付层"

**问题**：部署结构是美国跑 Next.js、香港 Nginx 做入口，但香港只发布 `_next/static` 静态资源，**页面 HTML 仍从美国回源**。所以首字节 7.9 秒。

**证据**：
- `docs/hong-kong-static-deployment.md` 明确只同步 `_next/static` 与公开图片目录，不上传 HTML。
- 首页响应头 `x-nextjs-prerender: 1` + `s-maxage=31536000`，说明它**已经是预渲染页面**，不依赖登录态（会话由客户端获取）。这种页面完全可以作为静态 HTML 发到香港。

**升级动作**：

1. 把已预渲染的公开页（`/`、`/pricing`、`/explore/[slug]`）的 HTML 也纳入香港发布流程，按 `BUILD_TAG` 版本隔离，沿用现有的"不覆盖旧文件 + 原子切换"机制。
2. `explore/[slug]` 目前是 `force-dynamic`，改为静态生成（内容来自配置，不依赖用户）。
3. 香港 Nginx 已开启 gzip；如已编译 brotli 模块可再开启 brotli。
4. 排查"连接 60 秒不结束"：确认是否有长连接（SSE）或未结束的流式响应挂在页面上，导致浏览器一直处于加载态。

**预期**：中国访问首字节从 7.9s 降到 0.2s 量级；首页 LCP 有质的改善。

**代价**：改动集中在 CI 发布流程与 Nginx 配置，不涉及应用代码。

---

### U2 用 Next 16 原生能力替换自研方案

**问题**：项目里自建了一整套"常驻页面 + 手动路由拦截"的 SPA 外壳（`CreativePages` 的 `retained` 页面、`deferNavigation`、`NavigationContent`、`NavigationFeedback`、`StylesheetRecovery`）。这套东西是为"切换页面不白屏"手写的，复杂度高，也是首屏 CSS 重试、导航卡顿这些问题的来源。

**Next 16 现成能力**（`node_modules/next/dist/docs/` 中已确认）：

| 能力 | 作用 | 现状 |
| --- | --- | --- |
| `cacheComponents` + `partialPrefetching` | 预取目标路由的静态部分，导航即时可渲染 | 未启用 |
| 路由级 `<Suspense>` + 静态外壳 | 直接访问与客户端导航都能立即出骨架 | 只有一层 `loading.js` |
| `reactCompiler: true` | 自动 memo，替代手工 `useMemo` / `useCallback` / `memo` | 未安装、未启用 |
| Turbopack 构建 | 默认构建器，替代 webpack 分包配置 | 自定义 webpack 配置状态存疑 |
| `<ViewTransition>` | 缩略图到详情页的共享元素过渡 | 未使用，目前是硬切 |

**升级动作**：

1. 先启用 `reactCompiler`（需安装 `babel-plugin-react-compiler`，会让构建略慢），在画布和工作台这类 hook 密集的组件上收益最大，可以直接减掉一批手写 memo。
2. 评估 `cacheComponents` + `partialPrefetching`，逐步替换自研的外壳逻辑。这是一次中等规模重构，收益是删除大量易错代码。
3. 确认生产构建是否还在走 webpack；若是，把 `splitChunks` 迁移为 Turbopack 等价配置或直接删除（交给框架分包）。
4. 首页到详情页、作品列表到画布的过渡改用 `<ViewTransition>`。

**代价**：`cacheComponents` 会改变缓存语义，需要按路由逐个验证；建议放在交付层之后、工作台改造之前。

---

### U3 公共数据加服务端缓存

**问题**：灵感库是公开数据，但接口 `Cache-Control: no-store`，每次访问都查库、解析 JSON、再对 53 张内置图片做哈希（首次）。实测 8–24 秒。

**升级动作**：

1. 灵感库改为静态生成：构建时产出 JSON（或直接内联进页面），配合 ISR 定期刷新；管理端修改后触发重新验证。
2. 内置图片的哈希在构建时算好，运行期不再读文件。
3. 其余公共读接口统一加 `unstable_cache`（或 `use cache`），设置合理 TTL。

**预期**：公开页完全不依赖数据库往返；首屏内容和作品数据同源同缓存。

---

### U4 图片按用途分级

**问题**：全站大量 `unoptimized`，作品墙如果直接用 1024–2048px 原图，光首屏就是几十 MB。

**升级动作**：

1. 构建期为每张作品生成 320 / 640 / 1280 三档 WebP，保留原图用于详情页下载。
2. 作品墙只用 320–480 档；场景卡 640；瀑布流 640，详情页 1280。
3. CSS 骨架 + 渐显保留（已在设计稿中定义）。
4. 首屏只加载视口内两列，其余延迟。

**预期**：首屏图片体积从数十 MB 降到 1–2 MB 以内。

---

### U5 建立可验收的测量基建

**问题**：方案里写了"LCP < 2s""JS 下降 40%"，但目前没有任何数据来源，也没有 CI 门禁，无法验收。

**升级动作**：

1. 接入 Web Vitals 上报（LCP、INP、CLS、TTFB），按页面汇总，写入现有数据库或轻量存储。
2. 在 CI 中对三个关键路由跑 Lighthouse（或 Playwright + PerformanceObserver），设定预算：首屏 JS < 基线 × 0.6、LCP < 2.5s（CI 环境取相对基线）。
3. 把 TTFB 纳入监控，区分"源站时间"与"链路时间"，避免优化错方向。

---

### U6 文档卫生：三份历史文档与新方向冲突

**问题**：`docs/archive/OPTIMIZATION_PLAN.md`（895 行）仍在建议"渐变系统、3D 效果、音效反馈、动态配色"，与本次"单一强调色、界面最小化"的方向**直接矛盾**；`docs/archive/PERFORMANCE_OPTIMIZATION.md` 仍在建议优化 `framer-motion`（已确认零引用）。任何人按旧文档执行都会往回退。

**升级动作**：三份文档移到 `docs/archive/`，在文件头加一行"已废弃，见 `frontend-redesign-spec-2026-11.md`"。`docs/` 下其余带日期的过程记录同样归档，只保留现行规范。

---

### U7 修正两份方案里的过期结论

| 位置 | 现有内容 | 问题 | 修正 |
| --- | --- | --- | --- |
| 收敛方案「设计系统 → Token」 | "保留品牌黄绿" | 已改为品牌橙 | 改为品牌橙 `#FF6A2B`，并指向重做方案 |
| 收敛方案「线上数据处理」 | 下线公告、迁移、分两步删表 | 用户已说明线上数据无需保留 | 简化为"删表前备份一次即可"，删除公告与迁移流程 |
| 收敛方案「性能」 | 直接从画布入手 | 漏了交付层 | 增加"第 0 层：交付"，并纳入性能目标 |
| 重做方案「4.2 措施」 | 只列了加载与缓存 | 同上 | 增加交付层与框架能力两项 |
| 两份方案的性能目标 | 只有 LCP / INP / JS 体积 | 缺 TTFB | 增加 TTFB 目标 |

---

### U8 删除范围补强

在原有删除清单之外，补上三项连带收益：

1. **Worker 运行环境**：删掉 Univer 之后，`creation-export` 镜像不再需要 `skia-canvas` 等原生依赖，镜像可显著变小。
2. **仓库卫生**：`docker/creation-export/node_modules` 里提交了 win32 原生二进制，应移出版本库（同时补进 `.gitignore`）。
3. **测试与配置**：删除对应的 Playwright 配置文件（现有 6 个）与 `test-results-*` 目录，CI 时间随之下降。

---

## 三、修订后的阶段

在原有排期前插入"第 0 层"，并把测量基建拆出来独立成一项。

| 阶段 | 内容 | 预估 | 验收 |
| --- | --- | --- | --- |
| **P-1 交付层** | 公开页 HTML 发到香港、开启压缩、排查长连接、`explore/[slug]` 静态化 | 3–4 天 | 中国网络首字节 < 500ms |
| **P0 测量** | Web Vitals 上报、CI 性能预算 | 2–3 天 | 三个关键路由有基线数据 |
| **P1 设计系统** | token、字体子集、16 个基础组件、lint 规则 | 1.5 周 | 组件页可预览全部变体 |
| **P2 首页** | 作品墙、输入框、场景区、瀑布流、图片分级 | 1 周 | 三套截图 + LCP 数据 |
| **P3 数据与框架** | 灵感库静态化、`reactCompiler`、Turbopack 确认、按需引入 `cacheComponents` | 1.5 周 | 公开页不再回源查库 |
| **P4 工作台** | 拆分单体组件、相机改造、生成过程反馈 | 2 周 | 缩放 60fps，INP < 200ms |
| **P5 其余页面** | 视频、PPT、电商、账户、登录、定价 | 2 周 | 视觉一致性评审 |
| **P6 删除与清理** | 模块删除、依赖清理、文档归档 | 1 周 | 构建通过，包体积下降 |

P-1 与 P0 可以并行，且**必须在 P2 之前完成**——否则首页做得再快，用户也要等 8 秒。

---

## 四、需要单独授权的操作

以下操作会改动依赖、执行构建或触碰线上配置，按 `AGENTS.md` 需要你明确同意后再执行：

1. 安装 `babel-plugin-react-compiler`（devDependency），启用 React Compiler。
2. 在本机或 CI 执行一次 `next build`，确认自定义 webpack 配置的实际状态与产物体积。
3. 修改香港发布流程与 Nginx 配置（HTML 纳入发布、开启压缩）。
4. 删除 `@univerjs/*`、`acorn`、`framer-motion`、`react-icons` 等依赖。

---

## 五、一句话总结

原方案解决的是"页面做得好看、交互做得顺"；这次补上的是"**用户能不能在 1 秒内看到它**"。两者缺一不可，而交付层的收益最大、成本最低，应该第一个做。
