# Commerce agent: sources and implementation

## Reused open-source material

- [ecommerce-visual-copywriting-skill](https://github.com/feichanggege/ecommerce-visual-copywriting-skill/tree/4a5a6396cd54709a203a82065801f64d5cb7286e), commit `4a5a6396cd54709a203a82065801f64d5cb7286e`, MIT, copyright 2026 OpenClaw Community. The evidence rules, campaign style lock, variable storyboard, product fidelity and review dimensions are adapted into `src/lib/commerce/agent.js`. The original source is retained in `commerce-visual-skill.md`; the complete license is `commerce-visual-LICENSE.txt`.
- [Loomic](https://github.com/fancyboi999/Loomic/tree/21206c30054572291b9df000d84568aeca97aeda), commit `21206c30054572291b9df000d84568aeca97aeda`, MIT. Reviewed its Deep Agents construction, injected image-job tool, asset/canvas ID separation and result inspection. Architecture reference only: no Loomic code or bundled runtime is copied. ModelShot retains its existing document store, job queue, provider adapters and credit ledger instead of introducing Loomic's Supabase/PGMQ stack or a second execution framework.
- Jaaz's current custom commercial license is not treated as MIT; none of its code is incorporated. Open-AI-Design-Agent's remote agent proxy is not used as a self-hosted backend.

## Executable workflow

1. `/api/commerce/plan` reads owned product/style images and persisted project context. One admin-configured vision-language model call chooses clarification, an initial plan, or a targeted revision. Missing essential facts produce up to three questions. Initial output can contain 1–10 cards, optionally constrained by the user's requested count.
2. The validated decision includes product evidence, a shared art direction and individual visual tasks/copy. The server compiles a complete designed-image prompt per card. It rejects duplicate IDs, changed untargeted cards, invented targets, replacement of an existing plan, excess cards and excess attempts.
3. Generation uses `/api/commerce/run` and the existing durable image-edit jobs. Product identity always comes from the original product asset. Style and a previous result, when present, have distinct reference roles. Model selection follows the public image selection and existing admin tool routing. Parameters, source roles, section version and provider are checked at admission.
4. A conversation turn can revise selected cards, add cards or explicitly remove cards from the plan. It does not delete prior canvas layers. Changes increment only the affected card attempts. Unchanged cards keep their jobs/results.
5. A user can request a visual review of a completed current result. The language model receives original and generated images with explicit roles and returns a verdict, concrete issues and repair instructions. Further revision uses the normal conversation and generation controls.
6. Finished images append to the same document. Original sources, previous attempts, manual layers and messages remain. Opening the canvas uses that document ID. Downloads contain actual generated PNGs and the creative brief, without applying the old fixed photo-layout renderer.

This is a bounded, model-directed workflow, not an unbounded autonomous tool loop. Visual reviews and regeneration are explicit, separately priced actions; there is no hidden automatic paid retry loop. A model review is advisory, not a guarantee of product fidelity or legal/platform compliance.

## Persistence, billing and recovery

- Uses existing PostgreSQL documents/messages, BullMQ/outbox jobs and credit reservations; no database migration or local inference model required.
- First user request names the project. Every later turn keeps its document ID/name.
- Each planning/review call uses `languageCall` and its configured price. Invalid model plans fail inside that operation and release the reservation. Image jobs show the resolved edit-tool price; individual admitted jobs remain discoverable after partial submission.
- Request keys are retained across network failures in tab session storage. The server returns a saved turn by its key/digest before checking an obsolete version, without issuing another language call. Generation keys are pinned to document/card/attempt.
- Concurrent document changes are protected by optimistic versions. A conflict requires reopening the current project; results are not silently applied over another tab's changes.
- Existing commerce documents remain readable; legacy template images are not relabeled as generated outputs. Static inspiration examples still use their original preview renderer, outside the agent path.

## Deployment and acceptance

Configure a vision-capable language model as the backend planner, and at least one image model supporting reference edits. Qwen/Volcengine-compatible configured language endpoints and existing OpenAI/DashScope/Volcengine image adapters are reused. CPU servers only orchestrate these cloud calls.

Local unit tests cover variable counts, targeting, evidence/identity prompts, preserved history, API ownership/version guards, request replay and partial job admission. Browser fixtures cover the interaction, dynamic costs, generated-image download, themes and viewport sizes. Real model quality must be accepted after deployment with actual configured providers; fixture images do not prove image quality.
