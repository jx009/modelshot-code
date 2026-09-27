# Canvas configuration and operation

Read `jiaotu-development-plan.md` for the implementation and acceptance plan.

## Start

1. `npm install` (Node 22.14 / npm 10.9).
2. `npm run setup:local` preserves existing `.env`, validates the local database target, starts Docker services, deploys migrations and creates the storage bucket.
3. Run `npm run studio:dev` and `npm run worker` in separate terminals. Open `http://127.0.0.1:3210/zh/studio-v2`. This launcher sets the matching authentication origin; the current Windows machine reserves port 3000. `STUDIO_PORT` can override 3210. Sign in with the existing account flow. The old commerce workbench remains at `/zh/studio`.
4. For the installed local cutout engine run `npm run studio:tools`. Its Python virtual environment is isolated under `services/image-tools/.venv`, and the authentication key stays in ignored `.env`. `npm run test:studio-tools` runs a real cutout smoke check on a bundled sample without a paid API call.
5. For production use `npm run build`, then `npm start`, plus a separately supervised worker.

## Provider configuration

生产环境优先在管理后台“模型通道”配置。一个协议类型可以新增多个模型通道；`实际生图模型名` 只发送给供应商，`对外展示名称` 用于工作台模型选择和报价展示，`每次模型请求积分`决定该通道每次生成或参考编辑的真实冻结与扣费金额。OpenAI 兼容通道可填写独立的`视觉/对话规划模型`，再将其中一个通道设为“用于对话规划”。快速生图不调用规划模型，直接按用户输入执行单张生成或编辑。

环境变量仍可作为部署级覆盖（Web 和 Worker 必须保持一致）：

| Variable | Meaning |
| --- | --- |
| STUDIO_API_KEY | Image/vision API key; server only |
| STUDIO_BASE_URL | OpenAI-compatible base API URL |
| STUDIO_IMAGE_MODEL | Image model; defaults to existing provider config |
| STUDIO_CHAT_MODEL | Vision-capable chat model for planning and reverse prompting |
| STUDIO_MASK_ENABLED=1 | Confirm this gateway supports the real multipart mask contract; required for custom base URLs |
| ARK_API_KEY | Volcengine Ark API key |
| ARK_VIDEO_MODEL | Your deployed Seedance endpoint/model ID; no invented alias |
| ARK_BASE_URL | Defaults to official Beijing v3 API |
| STUDIO_TOOLS_URL / STUDIO_TOOLS_KEY | Private optional tool service (see services/image-tools/README.md) |

Local deterministic crop and canvas/text/export work without AI credentials. Generation/editing requires the image API. Mask edits additionally require verified mask support. Describe/plan needs a vision model. Remove background, OCR and super resolution need the private service. Split combines foreground extraction with masked background reconstruction.

No real billable provider requests are part of automated tests. The fake test supplier is only used by the isolated test runtime. Environment values and local `.env` files must not be committed.

## Tool implementation

画布工具按职责分成四类：本地几何处理（裁剪、文字图层）、模型生成/局部编辑（扩图、消除、局部修改、移动后的背景修复）、视觉理解（反推提示词、OCR）和可选图像工具服务（抠图、超分、图层拆分）。前端只负责选区、拖拽、参数与预览，最终任务仍由服务端创建、校验、计费和执行。

“物体移动”采用 Lovart 式画布内交互：用户用矩形或套索直接圈选对象，松手后浏览器立即生成透明前景，随后在原图上直接拖动；提交后服务端修复原位置并按最终偏移合成前景。当前矩形和套索选区是无需额外 GPU 服务的可用实现；后续接入 SAM 类交互式分割时只需增强选区生成步骤，不需要改动拖拽、计费和服务端合成合同。裁剪通过画布裁剪框和角点完成，扩图通过图片外侧边界完成，消除与局部修改继续直接在图片上涂抹。

## Prices and recovery

管理员后台“工具与计费”是专业工具价格和启停状态的来源；“模型通道”的`每次模型请求积分`是生成与参考编辑的价格来源。报价展示、任务创建、积分冻结和成功后的实际扣费读取同一份配置，不会只改前端数字。初始值为：生成/编辑 18、扩图 18、超分 4、反推提示词/OCR 1、消除/局部修改/物体移动 18、抠图 2、图层拆分 20、视频 60、裁剪 0。它们是产品初始价格，不代表已核验的供应商成本，上线前仍需按真实成本调整。Studio tasks use credits, not legacy commerce free-image quotas; both use the same ledger.

Creation, reservation and Outbox commit together. Provider results are stored as a manifest before capture; recovery can settle the stored result without reissuing generation. An async video task ID is persisted in GenerationAttempt. Polling has a finite reconciliation window. Unknown synchronous results are not blindly resubmitted; after expiry credits are released and the error remains for operator review. Cancellation prevents new submissions where possible; it cannot guarantee cancellation at a supplier that already accepted the request.

## Known product boundaries

- Frontend follows Lovart-style canvas-first interaction with ModelShot branding; it is not a claim that every private Lovart behavior or model capability is replicated.
- Split produces a transparent foreground and repaired background, not a fully reconstructed PSD. Move selection supports rectangle and lasso; automatic semantic edge refinement still requires a separately deployed segmentation service.
- OCR replacement creates a movable text layer after background repair; original font matching, perspective and complex typography require manual adjustments.
- Video currently implements one explicit Ark content-generation contract; other providers require separate adapters and real credentials.
- Cloud document saves use version checks. Local draft recovery also retains an in-progress plan. Results append as new layers instead of overwriting current work.
- GPU engines and real provider quality/cost/latency must be verified separately before commercial launch.
