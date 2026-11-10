import { z } from "zod";
import { paramsSchema } from "../../studio/tools.js";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const videoShotSchema = z.object({ sceneId: id, provider: id.optional(), params: paramsSchema }).strict().superRefine((value, ctx) => {
  if (value.params.motion || value.params.referenceRoles || value.params.preserveOutside || value.params.feather) ctx.addIssue({ code: "custom", message: "INVALID_VIDEO_TOOL" });
});
export const videoRunSchema = z.object({ documentId: id, documentVersion: z.number().int().positive(),
  summary: z.string().max(1000), maxCredits: z.number().int().min(0).max(200000),
  shots: z.array(videoShotSchema).min(1).max(12),
  expectedCosts: z.array(z.number().int().min(0).max(200000)).min(1).max(12),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.shots.map(shot => shot.sceneId)).size !== value.shots.length || value.shots.length !== value.expectedCosts.length) ctx.addIssue({ code: "custom", message: "PLAN_QUOTE_INVALID" });
});
