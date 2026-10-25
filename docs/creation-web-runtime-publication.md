# 网页交互预览与发布增量

2026-10-25。基于 `9f1a3eb` 工作区的 B4 源码补齐记录。仅记录本批；不代表整个 Cheso 对标方案完成。迁移和公网部署未执行，最终提交状态见 Git。

## 已实现

- JS 文件进入现有选区 AI 流程，保留 ID/路径/种类、固定版本、权限、CAS、冲突副本检查。模型只能改选中的文件；继续禁止网络调用和父窗口访问。
- 静态预览保持无脚本；用户打开交互预览后才延迟加载独立运行组件，连接 `CREATION_PUBLICATION_ORIGIN/api/creation-preview`。
- 运行 iframe 仅有 `allow-scripts`，没有 `allow-same-origin`。公开 shell 校验应用来源、父窗口和一次性令牌；宿主校验消息源窗口、opaque origin、令牌、消息字段和页面白名单。作品正文通过消息发送，不放 URL 或公开存储。
- 交互预览支持本地脚本、表单控件、`data-*` 选择器和多页面链接。主站只接受项目内 HTML 文件身份，切页重新运行对应页面。缩放保留当前 iframe；隐藏/卸载会移除 iframe、请求、监听器和定时器。
- 修复预览重复 render 时脚本重复添加、脚本内容含 `</script>` 导致源码被截断的问题。
- 修复撤回未读取 `expectedRevision`；发布/回滚/撤回均校验预期版本，重复命令不能用同一 saveKey 改写成另一版本。
- 当前站点地址通过 307 跳转到 `/api/public-sites/<slug>/~v/<revision>/<entryPath>`，包括嵌套首页。相对资源固定在同一发布版本；后续发布不会让旧页面读取新 CSS/图片。
- ZIP 与在线发布共享 HTML/CSS/JS 静态模块引用重写：根路径改为相对路径，保留查询/锚点和未涉及源码。缺失文件、越界路径、外部资源地址在发布前报错；图片必须关联当前作品版本的素材，单图 ≤8 MiB，总计 ≤64 MiB。普通文本中的 URL 不会被改写。
- 发布指针仅指向已持久化的作品版本；回滚创建新的发布版本但引用旧作品快照，不覆盖草稿。撤回后所有 `~v` 历史 URL 均返回不可访问。

## 配置与访问

```dotenv
NEXTAUTH_URL=https://app.example.com
CREATION_PUBLICATION_ORIGIN=https://preview.example.net
```

两个来源必须不同。生产使用 HTTPS，并使用不会携带主站 Cookie 的独立域名。预览域反向代理保留 Host，仅开放以下路径，其他路径返回 404：

| 路径 | 功能 |
| --- | --- |
| `/api/creation-preview` | 无账号凭据的静态运行 shell，只接受配置的主站嵌入 |
| `/api/public-sites/*` | 已发布资源，逐请求检查发布状态；撤回即时生效 |

主站认证接口 `/api/creation/preview-runtime` 返回公开 shell 地址，不返回凭据。没有配置时交互预览提示不可用，静态预览仍可使用。若网关对所有响应设置 `X-Frame-Options: DENY/SAMEORIGIN`，需让 shell 使用代码提供的 `frame-ancestors <主站来源>` 策略，否则主站无法嵌入它。主站若设置 CSP 的 `frame-src`，也需允许预览来源。

不需要新增数据库迁移；使用仓库现有 WebPublication/Revision/Command 与 ArtifactRevision 表。数据库尚未运行现有创作迁移时，必须按总交付顺序先应用迁移。本批未执行迁移、配置域名、启动 Worker 或部署。

## 验证证据与边界

- 本批收口：上述命令的 11 文件 / 75 项定向单测通过；真实 Chromium 1 项通过；15 个涉及的生产源码文件 ESLint 已通过，`git diff --check` 通过。以下保留中间分组记录，不累计相加。
- 4 文件 / 24 项定向单测通过：部署路径、发布状态、重命名和 ZIP；后续继续新增了两版本生命周期及外部引用用例。
- 6 文件 / 51 项定向单测通过：网页协议、AI 修改、工作流、编辑器、发布、ZIP；有重复覆盖，不作为累计测试数。
- 5 文件 / 29 项定向单测通过：两次发布、读取固定旧版资源、失败替换、回滚、撤回，运行消息协议、框架生命周期与静态/交互切换。
- 真实 Chromium 定向用例通过：独立来源 shell 执行本地按钮逻辑与中文输入，页面链接回传，父文档访问被浏览器拒绝，外部 fetch 被实际 CSP 阻止；未观察到该外部网络请求。

运行命令（串行，无数据库、队列、付费模型或生产构建）：

```powershell
npx vitest run --project unit --no-file-parallelism --maxWorkers 1 tests/unit/creation-web-publications.test.mjs tests/unit/creation-web-deployment.test.mjs tests/unit/creation-web-runtime.test.mjs tests/unit/creation-interactive-web-frame.test.jsx tests/unit/creation-web-preview-ui.test.jsx tests/unit/creation-web.test.mjs tests/unit/creation-web-language.test.mjs tests/unit/creation-web-workflow.test.mjs tests/unit/creation-web-editor.test.jsx tests/unit/creation-web-rename.test.mjs tests/unit/creation-web-zip.test.mjs
npx playwright test --config tests/creation-web-runtime.config.mjs
```

浏览器用例拦截两个测试域名，使用真实运行 shell、实际响应 CSP 和真实 Chromium，不启动测试服务。发布状态单测使用数据库/存储替身；**尚未证明真实 PostgreSQL/对象存储/公网域名发布链成功**。它们也不能证明旧首页、画布、电商 Agent 的生产 p95 性能。

## 本轮补充与限制

- 本地 ES 模块现已接通：Acorn 精确解析 import/export，预览通过 importmap/data URL 解析模块图（包括循环依赖）；不把普通字符串或注释误当路径。重命名、ZIP、发布共享源范围重写。解析器锁定 8.16.0，由交互预览延迟加载。
- SVG 使用白名单保留路径、基础图形和局部渐变引用，移除脚本、foreignObject 和外部引用；交互表单保留 submit 按钮语义，CSP 仍禁止外部提交。
- 公开模块响应提供不带凭据的 CORS；发布状态和资源权限每次查询。不可变字节缓存 32 MiB/64 项/60 秒，在途合并、读取并发 2、待处理上限 32；数据库授权不缓存，撤回仍立即生效。
- 最新 Chromium 运行用例包含本地模块导入和执行；对应新增模块/重命名/发布/缓存等回归通过，完整本轮分组见 [交付说明](cheso-alignment-implementation-status.md)。
- 动态 import、外部包/CDN、外部 API、服务端程序不支持；复杂网页不保证所有 DOM 操作可视编辑。真实数据库/公网生命周期、容量与生产性能仍需验收。
