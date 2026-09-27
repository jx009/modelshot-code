# Canvas configuration and operation

Read `jiaotu-development-plan.md` for the implementation and acceptance plan.

## Start

1. `npm install` (Node 22.14 / npm 10.9).
2. `npm run setup:local` preserves existing `.env`, validates the local database target, starts Docker services, deploys migrations and creates the storage bucket.
3. Run `npm run studio:dev` and `npm run worker` in separate terminals. Open `http://127.0.0.1:3210/zh/studio-v2`. This launcher sets the matching authentication origin; the current Windows machine reserves port 3000. `STUDIO_PORT` can override 3210. Sign in with the existing account flow. The old commerce workbench remains at `/zh/studio`.
4. For the installed local cutout engine run `npm run studio:tools`. Its Python virtual environment is isolated under `services/image-tools/.venv`, and the authentication key stays in ignored `.env`. `npm run test:studio-tools` runs a real cutout smoke check on a bundled sample without a paid API call.
5. For production use `npm run build`, then `npm start`, plus a separately supervised worker.

## Provider configuration

The image API inherits the existing active `openai` admin configuration and encrypted API key. Optional environment overrides (set on web AND worker):

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

## Prices and recovery

The tool registry is the single source for UI/server prices: image operations 18 credits, upscale 4, describe/OCR 1, cutout 2, split 20, video 60, crop 0. These are initial product prices, not verified supplier costs. Adjust with real cost data before launch. Studio tasks use credits, not legacy commerce free-image quotas; both use the same ledger.

Creation, reservation and Outbox commit together. Provider results are stored as a manifest before capture; recovery can settle the stored result without reissuing generation. An async video task ID is persisted in GenerationAttempt. Polling has a finite reconciliation window. Unknown synchronous results are not blindly resubmitted; after expiry credits are released and the error remains for operator review. Cancellation prevents new submissions where possible; it cannot guarantee cancellation at a supplier that already accepted the request.

## Known product boundaries

- Frontend matches the observed layout and tool workflow with ModelShot branding; it is not a claim that every private Jiaotu behavior is replicated.
- Split produces a transparent foreground and repaired background, not a fully reconstructed PSD. Masks use a brush, not automatic point-prompt SAM2 segmentation.
- OCR replacement creates a movable text layer after background repair; original font matching, perspective and complex typography require manual adjustments.
- Video currently implements one explicit Ark content-generation contract; other providers require separate adapters and real credentials.
- Cloud document saves use version checks. Local draft recovery also retains an in-progress plan. Results append as new layers instead of overwriting current work.
- GPU engines and real provider quality/cost/latency must be verified separately before commercial launch.
