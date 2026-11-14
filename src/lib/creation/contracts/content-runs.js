import { z } from "zod";
import { layoutId } from "./layout.js";
import { posterImageRequestSchema } from "./poster-image.js";

const layoutContentRunSchema = z.object({
  kind: z.enum(["poster", "slides"]), prompt: z.string().trim().min(1).max(12000), locale: z.enum(["zh", "en"]).default("zh"),
  maxCredits: z.number().int().min(0).max(200000), assetIds: z.array(layoutId).max(8).default([]), referenceIds: z.array(layoutId).max(8).default([]),
  width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192),
  pageCount: z.number().int().min(1).max(100).default(1),
  image: posterImageRequestSchema.optional(),
  imageProvider: layoutId.optional(),
  target: z.object({ artifactId: layoutId, baseRevision: z.number().int().positive(), pageId: layoutId, nodeIds: z.array(layoutId).max(100).default([]) }).strict().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.width * input.height > 40000000) ctx.addIssue({ code: "custom", message: "CANVAS_TOO_LARGE" });
  if (input.kind === "poster" && input.pageCount !== 1) ctx.addIssue({ code: "custom", message: "POSTER_REQUIRES_ONE_PAGE" });
  if (input.image && (input.kind !== "poster" || input.target)) ctx.addIssue({ code: "custom", message: "POSTER_IMAGE_REQUIRES_NEW_POSTER" });
  if (input.image && input.assetIds.length > 7) ctx.addIssue({ code: "custom", message: "POSTER_IMAGE_ASSET_LIMIT" });
  if (input.imageProvider && (input.kind !== "slides" || input.target)) ctx.addIssue({ code: "custom", message: "IMAGE_PROVIDER_REQUIRES_NEW_SLIDES" });
});
export const contentRunSchema = layoutContentRunSchema;
