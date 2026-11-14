> 已归档：本文为历史过程记录，结论可能已过时。现行方案见 `docs/frontend-redesign-spec-2026-11.md` 与 `docs/product-refocus-plan-2026-11.md`。

# 文档引擎接口核对与接入边界

日期：2026-10-24。状态：已获用户许可安装锁定版本 Univer 1.2.0；安装与依赖检查完成，原生快照存储和运行适配代码已写出，已在定向测试实际运行 Docs/Sheets 核心数据模型；尚未接入工作台 UI，也未通过浏览器编辑/性能选型验收。文档准入仍不对用户开放。

## 样式隔离、保存接口与本地恢复（本次追加）

- 新增只匹配两个已安装 preset `lib/index.css` 文件路径的 PostCSS 插件，在已有 Tailwind 插件之前处理。将通配变量/滚动条重置和无前缀工具类限制到原生编辑容器及 Univer 命名空间元素，保留正常的 Univer 命名空间选择器与 body portal 样式。通用 enter/exit 动画重命名为 cw-native-enter/exit。应用自己的 CSS 不修改；未来遇到未审核的全局元素选择器/动画名会明确报错，不能悄悄影响主体。
- 测试对实际安装的 Docs/Sheets CSS 执行 PostCSS 转换，核对声明保持、动画名改写、重复处理幂等、旧页面元素不匹配重置规则、编辑器和 portal 子元素仍匹配；不需要浏览器运行时观察器或 DOM 样式重写。**尚未运行 Next 构建或浏览器视觉验收，仍需验证打包后的 source 路径、CSS 加载顺序及真实浮层/暗色模式。**
- 增加 `/api/creation/artifacts/:id/native` 的 GET/PUT，以及 copy/restore POST。kind 从已鉴权作品元数据决定读取/恢复，保存/复制由领域层校验同 kind、归属和不可变原生 ID；没有新增 create/升级路由。固定版本读取、private/no-store、写入同源检查、JSON 类型/流式字节上限和按用户限流均接上。请求上限比 2 MiB 快照多 1 KiB 封装余量；新准入关闭不阻断既有原生作品保存/恢复。旧 schemaVersion=1 不能通过该接口偷偷升级。
- 新增 `native-office-journal.js` 与实际 API/IndexedDB 接线 `native-office-session.js`。按浏览器草稿分支保存最新快照与一个冻结的在途请求，先落盘后发送，网络保存限制 30 秒；不保存每一步的全量历史数组。迟到 ACK 之后的新快照使用新的 baseRevision 和保存键；响应不明时始终重发原内容/键。重开先恢复旧请求再核对云端版本，不把已保存但响应丢失误判成冲突。
- 草稿写入立即调用现有按 key 串行的 IndexedDB 接口，不延迟到私有 Promise 队列中，避免卸载后的写入尚未登记、重开读取抢先发生。配额或落盘失败时不发送新请求；服务器成功但清理本地日志失败时保留恢复路径，下一次可以仅修复本地状态。旧实例关闭后不接受迟到网络结果更新内存，已登记本地写入仍完成。仍依赖现有 4 MiB 单草稿/20 MiB 总量/10 草稿组配额，不能宣传崩溃零丢失。
- 版本冲突保留完整本地快照，不自动覆盖云端或基于最新版本重放整稿。另存副本固定标题/正文/键，先落盘意图；响应丢失、重开或导航失败可找回同一份副本。副本已确认后仍保留原草稿，供后续 UI 明确打开副本/处理原草稿；不会自动删除草稿。未确认结果的普通保存不能直接另存副本，以免丢弃未知请求。
- **本次 6 个定向文件、33 用例串行通过**（新增样式4、路由4、日志9、会话3，及原生合同7/存储6回归）；14 个触及代码/测试文件 ESLint 通过。路由/网络/磁盘使用替身，CSS 用实际包源码处理，核心数据模型使用实际安装版本。没有数据库、浏览器、Next 构建、公式 Worker 或实际性能测试。
- 后续仍需：把原生 session 和 engine 绑定到工作台组件；处理 FDocument/FWorkbook 未提交输入、IME、撤销/恢复与 Activity 生命周期；完整文档适配和无损迁移；原生选区 AI 修改/导出、素材及插件运行准入。原生完整快照能存储不等于任意内容都可直接安全交给引擎渲染，持久化检查不能替代运行检查。

## 原生存储与运行适配进展（本次追加）

- `contracts/native-office.js` 定义独立 schemaVersion=2、engine=univer、engineVersion=1.2.0 的完整快照封装。snapshot 使用保留字段的 JSON 检查，不用会剥离未知字段的对象 schema；body、styles、notes、resources、自定义字段等保持原结构。限制总 JSON 2 MiB、深度 64、最多 25 万遍历项；拒绝循环、非 JSON 值、访问器和原型特殊键。共享对象引用允许以 JSON 的方式复制保存，不当成循环。
- 原生文档与工作簿做最小外形/索引检查：文档正文最长 30 万 UTF-16 单元；工作簿最多 20 表、10 万个稀疏 cellData 项，行列不越 Excel 边界。以上为存储拒绝上限，**不是性能支持声明，也不是全面引擎有效性或安全渲染判定**。resources 以原始字符串保存；不执行其内容，加载前仍必须核对具体插件、素材绑定、外部链接与公式运行策略。
- `native-office-artifacts.js` 复用现有不可变 blob/校验和、项目归属、版本 CAS、保存键幂等、素材引用和历史恢复。全文替换仅通过明确 opt-in 的 codec，拒绝带 sourceRunId 的 AI 全量覆盖。保存前后校验图片归属；unit ID 在同一作品中不可变；旧语义接口无法读取/修改原生正文。创建及修改同步 schemaVersion，读取历史版本返回对应正文版本，避免以当前元数据误标旧内容。尚未加公开路由/切换入口。
- `native-sheet-adapter.js` 将当前自产语义工作簿一次性转为原生数据：字符串（包括以等号开头的普通文本）、数字、布尔、空值、公式、基础格式、冻结行列与工作表顺序；稀疏坐标不展开网格。样式引用去重，源工作表/单元格 ID 放入 custom.modelshot，生成安全的原生表键，不误用 __proto__ 之类源 ID。没有实现从任意原生快照回压到旧 schema。
- 已用安装的 `@univerjs/core` 创建真实 UNIVER_SHEET/UNIVER_DOC 数据模型并读取快照：校验生成表格的值/公式和原生合并信息、自定义资源、文档脚注/样式/分页模式保留。没有注册浏览器 UI/渲染/计算插件，因此不证明 FDocument.save/FWorkbook.save 的全插件往返、分页显示或公式结果正确。
- 浏览器运行适配拆为 docs/sheets 两个静态动态 import 路径；语言包仅按当前语言加载。引擎实例先取得所有权再注册插件，以便注册中途异常时释放；关闭时依次释放事件、facade、unit、API、engine 和自持公式 Worker，任何一个释放异常不跳过后续。变更事件只递增序号，不逐键序列化；snapshot() 明确按需读取副本。加载取消后不会初始化过期文件。undo 历史限制 50 组，仍需测每组内存。
- Sheets 使用专用 module Worker、Univer RPC 与公式 Worker preset；15 秒启动握手期限，错误明确返回，无静默主线程计算降级。公开 RPC 源码确认传入 Worker 实例时由调用方负责 terminate，因此适配层显式持有 lease，在超时/错误/关闭时终止。当前 Worker 生命周期测试使用替身，**未运行浏览器中的真实公式 Worker/打包产物**。
- **发现待处理的样式边界**：两个 preset CSS 含 `* { scrollbar-color: initial; scrollbar-width: initial; }`、通配变量与未加 univer 前缀的少量工具类；直接加载到主应用可能污染主体。现有运行模块尚未被产品入口引用，接入前必须完成 CSS 隔离，并验证浮层/portal、字体/主题和离开后的样式恢复。不能把动态 import 等同于样式天然隔离。
- 本次 5 个定向文件、30 用例串行通过（含原有 artifact codec 回归），14 个触及源码/测试文件 ESLint 通过。未构建、启动服务/数据库/Worker、应用迁移或做浏览器/性能验收。后续仍需文档全部语义块适配、原生快照保存路由/草稿恢复、未提交输入 flush、选区 AI 原生定位、导出适配与受限运行准入。

## 安装进展（本次追加）

- 用户明确许可“允许安装锁定版本的 Univer 1.2.0”。主项目已加入精确依赖 `@univerjs/presets@1.2.0`、`@univerjs/preset-docs-core@1.2.0`、`@univerjs/preset-sheets-core@1.2.0` 与预设所需 peer `rxjs@7.8.2`，更新 npm lockfile。所读三个入口包声明 Apache-2.0，预设声明兼容 React 19；这不覆盖额外商业插件。
- 串行执行 `npm install --save-exact --ignore-scripts --no-audit --no-fund`，新增 170 个包。`npm ls` 定向检查通过；与本次安装前 lockfile 比较，既有依赖版本没有改变，React/ReactDOM 仍是 19.2.4。引擎包为 1.2.0；设计包依赖的独立图标包为它明确指定的 `@univerjs/icons@1.46.0`，不强制改成引擎版本号。
- 安装前备份了已包含未提交改动的两份清单，没有以 Git HEAD 覆盖原改动。未运行依赖生命周期脚本、Prisma 生成、构建、服务、数据库或浏览器；未将 Univer 导入首页、旧画布或现有编辑器。依赖已安装不代表已交付 Word/Excel 原生编辑能力，也不代表按需拆包和性能已验收。
- 下一步是完整原生快照的权威存储、语义投影、版本/草稿保存及按需编辑器生命周期。遵循下方往返约束，不将 `save()` 返回的原生数据强行压回当前简化合同。

下文“未安装”的表述记录此前研究阶段，已由上方安装进展更新；其中运行、性能与原生保存验收仍未完成。

## 本轮核对的公开版本

核对 npm 注册表发布的 `@univerjs/core`、`docs`、`docs-ui`、`preset-docs-core`、`presets`、`telemetry` 的 **1.2.0**。读取包元数据、类型声明及入口源码，研究副本位于工作区 `tmp/univer-1.2-research`；没有执行包代码、生命周期脚本或依赖安装，没有修改主应用依赖。

公开来源：

- [Core 版本元数据](https://registry.npmjs.org/@univerjs/core/1.2.0)
- [Docs 版本元数据](https://registry.npmjs.org/@univerjs/docs/1.2.0)
- [Docs UI 版本元数据](https://registry.npmjs.org/@univerjs/docs-ui/1.2.0)
- [Docs preset 版本元数据](https://registry.npmjs.org/@univerjs/preset-docs-core/1.2.0)
- [Presets 版本元数据](https://registry.npmjs.org/@univerjs/presets/1.2.0)
- [Telemetry 版本元数据](https://registry.npmjs.org/@univerjs/telemetry/1.2.0)

以上包元数据声明 Apache-2.0。不能将其外推为全部可选插件、商业转换服务和任意版本的许可结论；也不能以类型声明证明功能已运行可用。

## 已确认的接口事实

| 内容 | 1.2.0 公开接口/源码 | 对本项目的影响 |
|---|---|---|
| 创建 | `createUniver({presets, plugins, ...})` 返回 `univer` 和 `univerAPI`；Docs facade 提供文档创建 | 仅在文档编辑器打开时初始化，不能在首页导入 |
| 预设 | `UniverDocsCorePreset` 注册 network、docs、render、UI、docs-ui、formula 六种插件 | 并非一个轻量 DOM 文本框；实际包体积/初始化必须测量 |
| 配置 | preset 可配置 container/header/footer/toolbar/ribbonType/menu/contextMenu/disableAutoFocus/toc | 可在统一工作台内控制工具栏，不能通过类型字段推断所有菜单都能安全屏蔽 |
| 原生保存 | `FDocument.save(): IDocumentData` 声明保存内容与资源 | 权威快照必须考虑 resource 数据，不能只保存 body.dataStream |
| 释放 | `FDocument.dispose()` 仅释放 facade；卸载文档要用 `univerAPI.disposeUnit(id)` | 切换文件时要释放文档、监听和引擎，避免多份大型实例驻留 |
| 文档模式 | `DocumentFlavor.TRADITIONAL=1`、`MODERN=2`、`UNSPECIFIED=0` | 需显式选 Traditional 才能谈物理分页；`!isModern()` 不能证明物理分页 |
| 稳定定位 | `IParagraph.paragraphId`、`ISectionBreak.sectionId`；可查询段落与文字范围 | 可以适配 AI 稳定对象引用，但必须验证删除/拆段/合段后的 ID 生命周期 |
| 修改 | `FDocumentTextRange.setText(text)`、`setTextStyle(style)`；范围固定于创建时 | 其他编辑改变位置后必须重新定位，不能缓存旧字符位置继续修改 |
| 选区 | Docs UI 的 `setSelection(startOffset,endOffset)`；离屏布局加载后才设置，并有新操作/文字变动失效规则 | AI 引用要有版本和原文校验，不能仅传屏幕坐标 |
| 权限 | 文档、段落/节及实体权限 facade | 项目内块锁定需实际映射和测试；不能以 UI 按钮禁用代替服务端校验 |

## 原生数据与现有语义模型的差异

`core/lib/types/types/interfaces/i-document-data.d.ts` 的 `IDocumentData` 除正文还有 styles、resources、settings、表格、图片、列表、页眉页脚、脚注/尾注、原始 DOCX XML 锚点和导出排除范围等。

正文是带控制符的 UTF-16 `dataStream`：段落 `\r`、节 `\n`、分页 `\f`、自定义块 `\b`，表格另有开始/行/单元格/结束控制符。以下位置边界不同，适配层必须分别处理：

- `textRuns.st/ed` 是左闭右开。
- `customRanges.startIndex/endIndex` 是两端包含。
- `tables.endIndex` 是表格结束控制符之后的边界。
- 段落与节的 metadata 位置须符合对应结束控制符规则，不能简单等同于段落起点。
- `ITextStyle.fs` 使用 pt；页面尺寸和部分边距使用 96 DPI 布局像素。本项目当前文档 schema 的字体、段间距、页边距使用 pt，图片框使用 CSS px，适配要明确换算。

当前 `contracts/document.js` 只表示自产 AI 文档的有限语义：标题、段落、列表、矩形表格、图片、分页和简单页面设置。它不覆盖引擎原生文档所有内容。**不能把任意 `FDocument.save()` 反向压缩成该 schema，之后将丢失的脚注/合并单元格/样式称为保存成功。**

后续接入应按一个权威正文设计完成：

1. 自产语义文档经一次明确版本的适配生成原生快照；适配器覆盖已有全部块类型，遇到不支持内容明确拒绝。
2. 人工编辑后保存完整原生快照；语义内容是受限投影，用于检索/AI/受支持导出，不是第二份可独立覆盖的权威正文。
3. AI 操作定位原生稳定 ID，携带固定 revision 和原文校验，重新解析编辑范围；不为了改一个段落重建整稿。
4. 引擎允许新增的功能必须在原生存储、素材授权、版本、撤销、导出能力报告中有定义。不能直接把任意 URL/插件资源作为可信资产保存。
5. 原生快照与 AI 投影版本绑定；无法无损投影时保留原生数据并禁用该范围的自动修改/导出，而不是丢字段。
6. DOCX 原文件和 OOXML 定向回写另行处理；自产 DOCX 导出不等于任意 DOCX 往返。

以上是接入设计约束，不是已经写成并验证的原生适配器。当前后台和 DOCX 导出仍面向 schemaVersion=1 的自产语义文档。

## Telemetry 核对

不能仅因依赖名含 telemetry 就声称编辑器自动上传文档。核对的 `telemetry/lib/es/index.js` 仅导出服务 identifier；`presets/lib/es/index.js` 负责创建引擎/注册指定插件，Docs core preset 的插件列表没有 telemetry 插件。这只说明这些入口里未发现自动遥测注册，**不证明所有传递依赖或实际运行没有网络请求**。接入验证仍需记录编辑器打开、输入、保存和空闲期间的实际请求，关闭产品不需要的外部服务。

## 必须完成的运行验证

- 锁定依赖及所需插件/本地语言包/CSS，只让 `/creation` 的文档编辑器动态加载；检查首页与旧画布构建包。
- 新建/保存/关闭/重开原生快照；段落拆合、跨段粘贴、表格增删与合并、图片替换、页眉页脚、撤销重做、中文输入法、手机键盘。
- 原生与语义往返、稳定 ID、选区原文一致性、过期版本冲突、草稿恢复和未提交输入导航保护。
- 按方案标准样本测量初始化时间、长文输入延迟、主线程长任务、堆内存以及切文件后释放；性能限额不是元数据可以验证的。
- Word/WPS 原生导出和支持范围内导入；对不支持 OOXML 特性提供报告并保留原文件。

主项目 `AGENTS.md` 默认只允许轻量静态检查；用户已另行授权串行定向单元测试，以及固定 Univer 1.2.0 依赖安装。依赖已安装；构建、服务和数据库验证仍未执行。

## 原生 UI 接线现状（2026-10-24）

`OfficeArtifactEditor` 经私有格式元数据路由分发新旧 codec；`NativeOfficeArtifactEditor` 已连接原生 session、日志、引擎控制器、延迟保存和冲突副本。没有公开原生创建/升级接口，旧 AI/导出仍只处理旧格式。不能将这次 UI 接线视为完整 Office 编辑器交付。

控制器按 mutation 序号合并捕获，不为每个键创建快照/React 状态；草稿暂停 800ms 捕获，持续输入约 5 秒尝试捕获，云端合并 5 秒。切换前等待确认后的修改保存；Activity 隐藏释放、重开恢复；beforeunload 对未确认内容提示。单元格/输入法尚未确认时拒绝显式 flush，提示用户先确认。原因是已核对的 `endEditingAsync` 不代表异步校验完成；未确认输入崩溃恢复、校验完成信号及真实浏览器导航仍待补齐。

初期运行准入仅开放部分原生内容。未知资源不删除，未接入的图片/链接/命名公式拒绝执行；普通快照仍可完整保存。准入不是完整输入沙箱、公式预算或导入安全结论，编辑后新增特性也可能需要后续适配才能重开。因此在写入命令约束、计算规模控制、原生导出/AI 和运行验收完成前，不开放公开原生新建/升级。

## 当前自产文档转换与开放条件（2026-10-24 追加）

上述“未接入图片/链接”等记录已推进：`native-document-adapter.js` 现覆盖当前语义合同中的所有块类型和页面设置，运行准入允许本项目鉴权素材 URL、安全 HTTP(S)/mailto 链接与 PAGE/NUMPAGES 字段。未知资源、外部图片/背景/填充图片仍拒绝；原生导出与 AI 仍未完成。源文档含锁定块暂拒绝转换，等待实现等价权限后再开放此情况。

转换以单独副本完成，不覆写原 artifact 格式。服务端读取指定已鉴权 revision，固定创建键/单位 ID，创建记录可幂等重放。界面先保存源文件，再记本地请求日志；不会自动把正在编辑的源页面换成早先版本的副本。`CREATION_NATIVE_OFFICE_ENABLED` 新准入开关默认关闭，需同时开启 workspace，仍必须在安全/编辑/导出与真实运行验收后才能开放。本轮没有设置它。

再次强调结构事实：`IDocumentBody` 的表格结束符 prose comment 与安装包枚举不同。1.2.0 实际 TABLE_ROW_END=0E、TABLE_END=0F，CUSTOM_RANGE_START=1F、END=1E。已用真实 `validateDocumentStructure` 验证转换后的表格/嵌套链接/分页/页眉页脚，再用真实 core 数据模型读取快照；不能以早期注释作为编码依据。

公式 Worker 现在向主线程发计算开始/结束信号，持续计算默认 10 秒由主线程终止，未采用 Worker 内 timer 作为唯一限制。存在浏览器后台节流和瞬时内存分配风险；这项措施不能替代公式复杂度限制、真实内存/CPU 测量、超时后的人工修复模式及发布验收。

## 原生表格的受限 AI 修改（2026-10-24 追加）

`sheet.native.edit` 已接通选区引用、后台语言执行、受控原生操作和版本发布。完整快照保留为权威，仅将选中的值/公式投影给模型。局部样式复制到当前格，不原地修改共享 styles。固定 revision 上校验操作，CAS 冲突保存完整原生副本；不借用旧语义 sheet 的写入或导出接口。

第一期只允许最多 100 个普通单元格的值、受限标量公式和少量样式修改。含保护数据、共享/数组/动态公式的工作簿拒绝 AI；选中富文本/合并格也拒绝。保护等复杂内容仍可完整保存，不能为调用 AI 删除其字段。按普通标量函数语法限制公式，累计引用面积 100,000、公式字符 128,000；这些限制仅适用于本次 AI 路径，不是所有人工输入/任意导入文件的统一资源策略。

行列是坐标而不是稳定内容 ID；引用之后保存版本变化即要求重新引用。按键/选区事件不序列化全表；显式引用/提交/发布仍涉及完整快照校验、复制和稀疏公式遍历，需在真实浏览器测量其耗时。旧 Worker 心跳版本不能满足新版表格 pipeline 2。新准入仍默认关闭，原生文档 AI、原生导出和真实渲染/计算/性能验证尚未完成。

## 原生文档的受控文字修改（2026-10-24 追加）

原生文档 AI 现已接到 `document.native.edit` 后台链路，范围为保留结构的文字替换。通过已安装的 `DocSelectionManagerService` 获取单个连续文字选区；正文/页眉/页脚分别记录 segment，表格内连续文字可以引用，矩形选区暂不处理。选区按样式/段落/链接/批注边界形成最多 64 个片段，最多 12,000 UTF-16 单元，保留精确原文和固定 revision。模型只能返回这些片段的文字替换，不能借此插入控制符、改变格式或增删结构。

`native-document-edit.js` 不导入编辑器引擎；整份快照作为权威，批量替换只拼接正文一次，并一次遍历已知位置数组。不同索引语义分别处理，保留格式边界、链接身份、段落 ID、表格定义及图片锚点。未知非空位置元数据和无法解释的 note payload 拒绝 AI，不静默保留错误偏移或删除原数据；完整存储能力与 AI 修改能力仍是不同边界。已用真实 core 结构校验、数据模型和 TextX 对照验证，另使用真实 selection service 验证单位/segment 定位，但没有浏览器选区/分页/字体渲染结论。

后台读取固定版本、校验原文和范围，再执行付费任务；结果发布有 CAS，冲突存为完整原生副本。文档 pipeline 版本为 2，新准入默认关闭。原生导出、结构增删/排版工具、复杂保护/批注/任意 Office 导入、未确认输入恢复及真实视觉/性能验收仍未完成。当前不是 Word 全功能或 Cheso 全面对齐的交付。
