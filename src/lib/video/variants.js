import { z } from "zod";
import { validVideoParameters } from "./gptbest-catalog.js";
import { VIDEO_DURATIONS } from "./constants.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
// Administrators register only combinations verified for their upstream model.
// Protocol payloads stay server-side; users choose the labelled combination.
export const videoVariantsSchema = z.array(z.object({
  id, label: z.string().trim().min(1).max(100),
  resolution: z.string().trim().min(1).max(20).optional(), audio: z.boolean().optional(),
  durations: z.array(z.union(VIDEO_DURATIONS.map(value => z.literal(value)))).min(1).max(20),
  ratios: z.array(z.enum(["16:9", "9:16", "1:1", "4:5"])).min(1).max(4),
  creditCost: z.number().int().min(0).max(200000),
  parameters: z.record(z.string(), z.json()).refine(validVideoParameters),
}).strict()).max(24).refine(rows => new Set(rows.map(row => row.id)).size === rows.length);

export const videoFieldChoicesSchema = z.record(id, z.array(z.object({
  label: z.string().trim().min(1).max(100), value: z.string().trim().min(1).max(1000),
}).strict()).min(1).max(50)).refine(value => Object.keys(value).length <= 12);

function mergeParameters(base, overrides) {
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    next[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeParameters(base?.[key] && typeof base[key] === "object" ? base[key] : {}, value) : value;
  }
  return next;
}

export function selectVideoVariant(options, id) {
  const variants = options?.variants || [];
  if (!id) return variants.length ? { error: "VIDEO_VARIANT_REQUIRED" } : { options };
  const variant = variants.find(row => row.id === id);
  if (!variant) return { error: "VIDEO_VARIANT_UNSUPPORTED" };
  return { variant, options: { ...options, durations: variant.durations.filter(duration => options.durations.includes(duration)), ratios: variant.ratios.filter(ratio => options.ratios.includes(ratio)), parameters: mergeParameters(options.parameters, variant.parameters), configuredFields: [...new Set([...(options.configuredFields || []), ...(variant.configuredFields || [])])] } };
}
