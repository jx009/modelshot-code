# 文档 Markdown 与图片资源包

2026-10-25。状态：普通文档（schemaVersion=1）和 Univer 原生文档（schemaVersion=2）导出源码均已实现，定向测试通过，默认不开启；该功能不代表文档导入/往返、PDF 或整体工作台已经交付。

## 使用结果

文档导出弹窗增加 Markdown，点击“保存并导出”先提交未保存内容，再绑定确定的 revision。下载文件名为 `document-vN.markdown.zip`，其中包括：

```text
document.md
export-info.json
images/image-1.png
images/image-2.jpg
```

正文与图片一起解压使用。没有图片时仍为 ZIP，保持一致的返回协议和降级说明。`export-info.json` 记录入口、相对图片路径、阅读器要求及不保留的格式，不写入内部资产 ID、存储地址或页眉内容。标题/章节名等管理元数据不额外插入正文，以免重复用户实际标题。

| 源内容 | 输出 |
|---|---|
| 段落、中文、emoji、换行 | 转义后的 Markdown 文本；换行用 `br` |
| 一至六级标题 | 对应 `#` 标题，多行标题在同一标题内使用 `br` |
| 粗体、斜体、下划线、删除线 | 静态 `strong/em/u/del`，保留片段边界 |
| 链接 | 仅源契约允许的 HTTP/HTTPS/mailto；转义属性 |
| 嵌套列表 | HTML `ol/ul/li`，保留起始编号与最多六层缩进；孤立缩进使用不显示编号的容器 |
| 表格 | HTML 表格，保留零/一/二行表头、全部文本与安全富文本；不虚构首行为表头 |
| 图片 | 归属校验后在独立进程解码/转正为 PNG/JPEG，编号相对路径、重复引用去重；保留替代文字与说明 |
| 字体、字号、颜色、对齐、间距、图片显示尺寸 | 不保留，阅读器自行排版 |
| 页面尺寸、分页、页眉页脚、页码、编辑锁定 | 不保留，导出前提示并在清单记录 |

这是一种包含静态 HTML 的 Markdown 资源包，并非所有 Markdown 阅读器都支持的纯文本子集。禁用 HTML 的阅读器可能只显示源码或删除表格/样式。未宣称任意平台粘贴后排版一致。

## 核心实现与链路

- `src/lib/creation/exports/markdown.js`：`validateMarkdownDocument()` 校验完整源结构与字符；`buildDocumentMarkdown()` 生成正文、清单及固定路径 ZIP。复用现有 JSZip，无新依赖。没有通过 DOCX 或引擎临时格式再转换。
- `src/lib/creation/contracts/exports.js`：格式 `markdown`、普通版本 `document-markdown-1`、原生版本 `univer-document-markdown-1`、MIME `application/zip`、扩展名 `markdown.zip`。
- `src/lib/creation/exports/native-markdown.js`：直接读取经检查的原生 AST，保留正文、标题、富文本、安全链接、列表编号、表头及图片相对路径；不经过 schemaVersion=1 投影。页域保留可见缓存文本，不虚构取消分页后的新页码。命名样式、合并单元格、非空权限等未支持内容明确失败，分页/页眉页脚等格式省略写入清单。
- `src/lib/domain/creation/exports.js`：与 DOCX/XLSX 相同，在事务外检查固定 revision 的不可变正文格式、长度和校验和，再在事务内核对 revision ID/checksum。只信任历史文件的 schema，不按当前作品最新 schema 猜测。指纹包含固定版本、格式与转换器版本。
- `src/lib/creation/exports/layout-child.mjs`：解码图片前验证 Markdown 源；独立子进程动态导入转换器，继续使用校验后的私有图片。`creation-export-main.mjs` 公布单独的 `markdown` 心跳能力。
- `ExportDialog.jsx`：格式说明、保存后提交、sessionStorage 固定版本恢复、历史版本重试沿用已有机制。读取导出记录或打开弹窗不触发转换。
- `export-execution.js` 与下载路由沿用现有文档归属、图片归属、租约、取消、CAS 发布、私有存储及校验下载；扩展名和 MIME 自动来自格式描述。

普通新请求需 `CREATION_MARKDOWN_EXPORT_ENABLED=true`；原生新请求需 `CREATION_NATIVE_MARKDOWN_EXPORT_ENABLED=true` 和原生 Office 开关。两者分别核验新鲜、版本匹配的 Worker 心跳（原生键 `univer-markdown`）。DOCX 开关不能顺带开放 Markdown。当前未修改任何开关或启动 Worker。

## 性能与数据边界

转换只发生在独立导出子进程，首页/画布不导入 ZIP 或 Markdown 转换器；前端新增的是轻量格式描述与弹窗文案。子进程沿用 256 MiB V8 heap、120 秒期限、无数据库/模型/存储凭据与图片串行解码。不是浏览器导出，不占用聊天 token 更新或画布拖动的同步路径。

普通文档本身受 2000 块、10000 文本叶、300000 字符约束。图片按资产 ID 去重；累计解码最多 1600 万像素；打包前累计未压缩正文/清单/图片字节与最终 ZIP 均受 64 MiB 上限。输出是有界内存构造，不是流式 ZIP。V8 heap 不限制全部原生内存，部署资源限制和真实吞吐仍需验证。

不接受源 HTML：正文里的标签、属性、Markdown 标记均作为文字转义；只有转换器生成的固定静态标签进入正文。不得把普通图片文字变为远程请求，不把资产 API 地址或私有 ID 放进文件。非法控制字符/坏 UTF-16、缺图、超额图像、未知 schema 明确失败，原稿不受影响。

## 已验证与未验证

串行 **5 个定向测试文件 / 47 个用例通过**，**12 个触及 JS/JSX/MJS 文件 ESLint 通过**。测试覆盖：

- 中文/emoji、标题/安全链接/富文本、零及多表头、嵌套编号、源码不变、注入文本转义；JSDOM 解析生成的静态 HTML 结构。
- 图片重复引用、相对路径、字节预算、缺图及超像素拒绝、非法字符和原生快照拒绝。
- 独立开关/心跳、历史 schema 判定、固定版本/归属/发布、图片权限；数据库与存储为替身。
- React 弹窗保存后提交、丢响应重挂载恢复同一版本。
- 实际生产转换子进程，校验图片 SHA-256 后生成真实 ZIP，JSZip 重新解析并用 sharp 验证包内 PNG 尺寸；无需 Skia/字体运行时。

未运行完整 Markdown 阅读器兼容对照、真实数据库/队列/S3、浏览器下载或全站性能测试。JSDOM 只验证静态 HTML，不是 Markdown 解析器，不能替代阅读器验收。未新增安装、构建、迁移、模型调用或启动服务。首次列表测试失败是 DOM 排版换行进入断言，已修正断言；检查同时修复多行 Markdown 标题续行脱离标题的问题。

```powershell
npx vitest run --project unit --maxWorkers 1 --no-file-parallelism tests/unit/creation-markdown.test.mjs tests/unit/creation-export-policy.test.mjs tests/unit/creation-export-workflow.test.mjs tests/unit/creation-export-dialog.test.jsx tests/unit/creation-export-process.test.mjs
```
