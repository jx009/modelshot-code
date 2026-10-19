import { z } from "zod";
import { DEFAULT_ITEMS, DEFAULT_LAYOUT } from "./defaults.js";

export { DEFAULT_ITEMS, DEFAULT_LAYOUT };
import { INSPIRATION_CATEGORIES } from "./presentation.js";
export { INSPIRATION_CATEGORIES, inspirationImage, inspirationLabel, coverAspect } from "./presentation.js";
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const sourceUrl = z.string().max(1000).refine(v => !v || /^https?:\/\/[^\s]+$/i.test(v), "Use an http(s) source link");
export const inspirationItemSchema = z.object({
  id: safeId,
  title: z.string().trim().min(1).max(100), titleEn: z.string().trim().max(150).default(""),
  category: z.enum(INSPIRATION_CATEGORIES.slice(1).map(c => c[0])),
  description: z.string().trim().max(1000).default(""), descriptionEn: z.string().trim().max(1500).default(""),
  prompt: z.string().trim().min(1).max(4000),
  promptZh: z.string().trim().max(4000).optional(),
  model: z.string().trim().max(150).default(""),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1024"),
  quality: z.enum(["low", "medium", "high", "auto"]).default("medium"),
  imageVersion: z.string().regex(/^[a-f0-9]{12}$/).optional(),
  sourceUrl: sourceUrl.default(""), sourceAuthor: z.string().trim().max(200).default(""),
  sourceName: z.string().trim().max(200).default(""), sourceLicense: z.string().trim().max(100).default(""),
  cover: z.discriminatedUnion("type", [
    z.object({ type: z.literal("builtin"), file: z.enum(DEFAULT_ITEMS.map(i => i.id)) }).strict(),
    z.object({ type: z.literal("asset"), assetId: safeId }).strict(),
  ]),
  aspect: z.enum(["original", "square", "portrait", "landscape"]).default("original"),
  position: z.number().int().min(0).max(100).default(50),
  enabled: z.boolean().default(true),
}).strict();
export const gallerySchema = z.object({
  items: z.array(inspirationItemSchema).max(200).refine(items => new Set(items.map(i => i.id)).size === items.length, "Duplicate IDs"),
  layout: z.object({ mode: z.enum(["masonry", "grid"]), columns: z.number().int().min(3).max(5), gap: z.number().int().min(8).max(40) }).strict(),
}).strict();
export const defaultGallery = { items: DEFAULT_ITEMS, layout: DEFAULT_LAYOUT };
export function inspirationPromptZh(item) {
  if (typeof item.promptZh === "string") return item.promptZh.trim();
  // Previously saved galleries lack translations. Only reuse a built-in
  // translation when its original prompt still matches the published text.
  const builtin = item.cover?.type === "builtin" && DEFAULT_ITEMS.find(i => i.id === item.cover.file);
  return builtin && builtin.prompt === item.prompt ? builtin.promptZh || "" : "";
}
export function inspirationPrompt(item, locale = "zh") {
  return locale === "zh" ? inspirationPromptZh(item) || item.prompt : item.prompt;
}
