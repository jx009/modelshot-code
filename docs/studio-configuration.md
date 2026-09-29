# Canvas configuration and operation

Read `jiaotu-development-plan.md` for the implementation and acceptance plan.

## Start

1. `npm install` (Node 22.14 / npm 10.9).
2. `npm run setup:local` preserves existing `.env`, validates the local database target, starts Docker services, deploys migrations and creates the storage bucket.
3. Run `npm run studio:dev` and `npm run worker` in separate terminals. Open `http://127.0.0.1:3210/zh/studio-v2`. This launcher sets the matching authentication origin; the current Windows machine reserves port 3000. `STUDIO_PORT` can override 3210. Sign in with the existing account flow. The old commerce workbench remains at `/zh/studio`.
4. For the installed local cutout engine run `npm run studio:tools`. Its Python virtual environment is isolated under `services/image-tools/.venv`, and the authentication key stays in ignored `.env`. `npm run test:studio-tools` runs a real cutout smoke check on a bundled sample without a paid API call.
5. For production use `npm run build`, then `npm start`, plus a separately supervised worker.

## Provider configuration

生产环境在管理后台“模型配置”配置，分为生图模型、后台大语言模型、工具专用模型三个页签。用户只选择生图模型；工具专用模型和后台大语言模型不出现在公开模型列表。点击“新增模型”可以套用阿里百炼、火山方舟、fal SAM 3、fal Qwen 图层拆分或 OpenAI 兼容预设。填入平台 API Key 和可用模型名；火山可填写开通的模型 ID / Endpoint ID。密钥加密保存在服务端，工作台只接收通道标识、显示名、能力与积分价格。

| 用途 | 协议与建议通道 | 说明 |
| --- | --- | --- |
| 生成 / 局部编辑 / 背景修复 | 百炼 `qwen-image-2.0-pro`、`qwen-image-edit-max`；火山方舟 Seedream；OpenAI 兼容 | 选择对应供应商预设；Qwen Edit 只在工具专用模型中添加。百炼使用原生 multimodal API，方舟使用 images/generations JSON API。 |
| 按需框选 / 点选 / 套索选物体 | fal `fal-ai/sam-3/image` | 得到对象 mask 后保存透明物体与背景空洞，不在进入工具时枚举全图物体。未配置云端通道时可使用现有私有 segment 服务。 |
| 用户主动拆层 | fal `fal-ai/qwen-image-layered` | Qwen 模型托管 API；一次返回多个对齐图层。界面允许请求 2–8 层，实际层数以供应商返回为准。 |

阿里、火山的图像编辑接口不被冒充为分割或 RGBA 拆层接口。配置一个图像通道不会自动启用拆层。所有模型计算均可使用托管服务，不需要本机或业务服务器 GPU。最终边缘质量、生成画质、模型处理时间和厂商限流仍需用真实账户验证。

“工具配置”按工具绑定执行方式：图像工具可沿用用户生图模型或指定专用模型；裁剪是纯代码处理；反推提示词自动使用后台大语言模型。物体移动绑定支持多图参考的图像编辑模型；局部修改分别绑定物体分割服务和图像编辑模型；拆层使用后台绑定的专用模型。用户不能覆盖内部模型。正在执行的任务固定其提交时的供应商、协议和模型。已停用、不存在或能力不匹配的显式选择会报错，不会偷偷回退到其他厂商。模型名可以后续修改；已提交任务仍使用原模型。任务执行前若协议或 Base URL 变化，则中止并释放积分，避免把凭据发送到变更前的地址。

Base URL 支持官方服务和管理员配置的任意 HTTPS OpenAI 兼容网关，例如企业代理或自建转发地址。百炼工作空间地址需与 API Key 地域匹配；阿里、火山、fal 各自使用对应通道的凭据，旧 OpenAI 环境变量不会覆盖它们。

环境变量作为旧 OpenAI 通道未配置凭据时的回退；Web 和 Worker 应保持一致：

| Variable | Meaning |
| --- | --- |
| STUDIO_API_KEY / STUDIO_BASE_URL / STUDIO_IMAGE_MODEL | Legacy OpenAI-compatible fallback; stored channel credentials take precedence |
| STUDIO_CHAT_MODEL | Vision planner fallback when no planner channel is configured |
| ARK_API_KEY / ARK_VIDEO_MODEL / ARK_BASE_URL | Existing Ark video task configuration; image editing is configured separately in Admin |
| STUDIO_TOOLS_URL / STUDIO_TOOLS_KEY | Optional private service for remove-background, OCR and upscale |

后台“测试功能”会发起真实模型请求并产生供应商费用，自动化测试不使用真实付费 API。分割预览目前不扣用户积分，平台承担上游费用；接口按用户限流并缓存相同原图、选区和模型的成功结果。生产上线需要结合实际用量配置供应商额度。

### 配置物体移动

1. “模型配置 → 工具专用模型 → 新增模型”，选择阿里百炼 Qwen 编辑、火山方舟 Seedream 或支持多图编辑的 OpenAI 兼容接口，填写模型 ID、API Key 和地址。
2. “工具配置 → 物体移动 → 物体移动模型（完整场景编辑）”选择“指定工具专用模型”，选择刚创建的模型并保存。也可以选择“沿用用户选择的生图模型”，前提是该模型支持图像编辑和多图参考。
3. 物体移动不再依赖分割服务。矩形框选后立刻出现源区域和目标区域；两者均可拖动、缩放、旋转。位置未改变时不能提交。
4. 确认后进行一次图像编辑请求，发送完整原图、红色源区/蓝色目标区位置参考、编辑范围和说明。目标是生成移走物体、补全旧位置、融合新位置光影的完整场景，不再把透明抠图直接贴到修复背景。
5. 局部修改仍使用云端分割选择物体；火山 EntitySegment 的 AK/SK 配置仍供局部修改和实体拆层使用。OCR、超分、抠图继续使用 tools 服务，视频继续使用 ARK 部署配置。

升级会执行 `20260928090000_tool_routing`：为工具增加路由配置，并把已启用的旧 `chatModel` 规划配置复制成独立后台大语言模型。密钥仍为密文，旧图像通道保留。Web 和 Worker 必须同时升级。

## Tool implementation

- 物体移动：源区/目标区坐标在原图像素空间保存，旋转以区域左上角为原点；客户端约束边界，服务端再次检查四角。前端操作不发送分割请求。
- 移动生成：源区和目标区各扩展 20% 并羽化，保留场景上下文；多图编辑模型同时接收原图、位置引导图，以及原生 mask 或供应商适配的范围引导。结果校验比例并还原原尺寸，范围外像素保持原图，范围内的物体身份、遮挡与阴影质量取决于实际模型。过长的旧阴影或大幅移动仍需真实案例验收。
- 局部修改：点击、矩形或套索提供云端分割提示。编辑模型接收原图上下文、物体参考和可扩展编辑区域；范围外保留原像素。
- 拆层：支持火山 EntitySegment 和 Qwen-Image-Layered。一个拆层结果组内部保持原始位置关系，整个组放在原图旁边。火山不补全被遮挡内容。
- 结果交付：移动、局部修改、裁剪等生成完整新图片，与原图并排保留；加载失败可重试加载而不重新请求模型。旧版本已排队的物体移动任务保留执行兼容。
- 画布交互：图片旁竖向工具菜单；物体移动时聚焦图片；抓手、按住空格和中键平移独立于编辑状态；双击空白适应全部图片，双击图片打开带历史缩略图的预览；Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做。聊天面板可折叠。

自动化验证覆盖区域变换、原生供应商协议的本地 HTTP fixture、完整尺寸输出、范围外像素、能力配置、桌面/手机手势与任务恢复。fixture 不能验证真实模型的语义画质或耗时；部署后仍需用真实供应商完成画质验收。

## Prices and recovery

管理员后台“工具配置”是专业工具（包括拆层）价格和启停状态的来源；“模型配置”的生图模型积分用于生成和参考编辑，大语言模型积分用于对话规划、电商 AI 看图策划和反推提示词。每次成功的大语言模型调用只扣一次；失败释放积分，重复的幂等请求复用结果，不重新调用。报价展示、任务创建、积分冻结和成功后的实际扣费读取同一份配置，不会只改前端数字。初始值为：生成/编辑 18、扩图 18、超分 4、反推提示词/OCR 1、消除/局部修改/物体移动 18、抠图 2、图层拆分 20、视频 60、裁剪 0。它们是产品初始价格，不代表已核验的供应商成本，上线前仍需按真实成本调整。Studio tasks use credits, not legacy commerce free-image quotas; both use the same ledger.

Creation, reservation and Outbox commit together. Provider results are stored as a manifest before capture; recovery can settle the stored result without reissuing generation. Async video and fal layer task IDs are persisted in GenerationAttempt. A worker resumes the existing fal queue request after an interruption instead of submitting a second paid decomposition. Polling has a finite reconciliation window. Unknown synchronous results are not blindly resubmitted; after expiry credits are released and the error remains for operator review. Cancellation prevents new submissions where possible; it cannot guarantee cancellation at a supplier that already accepted the request.

## Known product boundaries

- Frontend follows Lovart-style canvas-first interaction with ModelShot branding; it is not a claim that every private Lovart behavior or model capability is replicated.
- Local-edit segmentation and decomposition require configured API channels. Region movement only requires the image-edit model. Model generation remains asynchronous; no first-call one-second SLA is promised.
- OCR replacement creates a movable text layer after background repair; original font matching, perspective and complex typography require manual adjustments.
- Video currently implements one explicit Ark content-generation contract; other providers require separate adapters and real credentials.
- Cloud document saves use version checks. Local draft recovery also retains an in-progress plan. Ordinary generation appends new layers; object edits append complete results alongside visible originals.
- GPU engines and real provider quality/cost/latency must be verified separately before commercial launch.
