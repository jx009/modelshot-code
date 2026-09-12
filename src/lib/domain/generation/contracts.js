import { createHash } from "node:crypto";
import { z } from "zod";

export const LIMITS = Object.freeze({ garments: 50, outputs: 100, activePerUser: 100, queue: 2000, leaseMs: 90_000, reconcileMs: 15 * 60_000 });
export const TERMINAL = ["succeeded", "failed", "cancelled"];
export const ACTIVE = ["queued", "running", "provider_pending", "reconciling", "cancel_requested"];
export const PROFILE_VERSION = "1";
export const PROFILES = {
  "1:1": { width: 1024, height: 1024 },
  "3:4": { width: 1200, height: 1600 },
  "4:3": { width: 1600, height: 1200 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  auto: { width: 1200, height: 1600 },
};
const optionalText = z.string().max(128).optional().nullable();
export const configurationSchema = z.object({
  images: z.array(z.string().max(128)).min(1).max(LIMITS.garments),
  personImage: optionalText, modelPresetId: optionalText, scenePresetId: optionalText,
  garmentType: z.enum(["top", "bottom", "dress", "outerwear", "swimwear"]).default("top"),
  aspectRatio: z.enum(["auto", "1:1", "3:4", "4:3", "9:16", "16:9"]).default("3:4"),
  provider: z.enum(["openai", "gemini", "fashn"]).optional(),
  variants: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  prompt: z.string().max(4000).default(""),
  pose: z.enum(["", "standing", "walking", "three_quarter", "sitting", "leaning", "closeup"]).default(""),
  camera: z.enum(["", "eye_level", "low_angle", "high_angle", "full_body"]).default(""),
  lighting: z.enum(["", "soft", "natural", "editorial", "golden"]).default(""),
  platformSpec: z.enum(["", "amazon", "tiktok", "taobao", "shein"]).default(""),
  name: z.string().max(100).default(""),
  sku: z.string().max(80).default(""),
  projectId: optionalText,
  retryOfId: optionalText,
}).strict().refine(value => value.images.length * value.variants <= LIMITS.outputs);

export function digestJson(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function batchState(outputs) {
  const counts = Object.fromEntries(["queued", "running", "succeeded", "failed", "cancelled"].map(key => [key, 0]));
  for (const output of outputs) {
    if (TERMINAL.includes(output.status) || output.status === "queued") counts[output.status]++;
    else counts.running++;
  }
  const status = counts.running ? "running" : counts.queued ? "queued" : counts.succeeded === outputs.length && outputs.length ? "succeeded" : counts.succeeded ? "partial_success" : counts.failed ? "failed" : "cancelled";
  return { status, counts, totalCount: outputs.length, completedCount: counts.succeeded, failedCount: counts.failed };
}
