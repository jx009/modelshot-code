import { z } from "zod";
import { DEFAULT_ITEMS, DEFAULT_LAYOUT } from "./defaults.js";

export { DEFAULT_ITEMS, DEFAULT_LAYOUT };
export const INSPIRATION_CATEGORIES = [["all", "全部灵感", "All inspiration"], ["manga", "漫画叙事", "Comics"], ["poster", "创意海报", "Posters"], ["commerce", "产品广告", "Products"], ["fashion", "人像时尚", "Fashion"], ["illustration", "艺术插画", "Illustration"], ["threeD", "3D 实验", "3D studies"], ["space", "空间场景", "Spaces"]];
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const sourceUrl = z.string().max(1000).refine(v => !v || /^https?:\/\/[^\s]+$/i.test(v), "Use an http(s) source link");
export const inspirationItemSchema = z.object({
  id: safeId,
  title: z.string().trim().min(1).max(100), titleEn: z.string().trim().max(150).default(""),
  category: z.enum(INSPIRATION_CATEGORIES.slice(1).map(c => c[0])),
  description: z.string().trim().max(1000).default(""), descriptionEn: z.string().trim().max(1500).default(""),
  prompt: z.string().trim().min(1).max(4000),
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
export function inspirationImage(item) {
  return item.cover.type === "builtin" ? `/inspiration/generated/${item.cover.file}${item.imageVersion ? `.${item.imageVersion}` : ""}.webp` : `/api/inspiration/${encodeURIComponent(item.id)}/image`;
}
export function inspirationLabel(item, zh = true) { const c = INSPIRATION_CATEGORIES.find(c => c[0] === item.category); return c?.[zh ? 1 : 2] || ""; }
export function coverAspect(item, mode = "masonry") {
  if (mode === "grid") return "1 / 1";
  return item.size.replace("x", " / ");
}
