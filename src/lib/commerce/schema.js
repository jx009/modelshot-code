import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const briefSchema = z.object({
  product: z.string().trim().min(1).max(80), brand: z.string().max(60).default(""),
  description: z.string().max(2400).default(""), material: z.string().max(200).default(""), dimensions: z.string().max(200).default(""), audience: z.string().max(200).default(""), scenario: z.string().max(200).default(""),
  platform: z.enum(["taobao", "amazon", "shopify"]).default("taobao"), region: z.enum(["CN", "US", "EU"]).default("CN"), language: z.enum(["zh", "en"]).default("zh"), style: z.enum(["natural", "editorial", "studio"]).default("natural"), theme: z.enum(["linen", "sand", "red", "ice", "mono", "citrus", "dark"]).default("linen"), caseId: z.string().max(80).default(""),
}).strict();
export const sectionSchema = z.object({ id, kind: z.enum(["hero", "benefit", "detail", "lifestyle", "specs", "closing"]), title: z.string().min(1).max(70), body: z.string().max(400), eyebrow: z.string().max(60), prompt: z.string().max(3800), layout: z.enum(["cover", "split", "inset"]), attempt: z.number().int().min(0).max(50).default(0) }).strict();
export const commerceSchema = z.object({ version: z.literal(1), brief: briefSchema, productAssetId: id.optional(), referenceAssetId: id.optional(), sections: z.array(sectionSchema).min(1).max(10), planning: z.enum(["template", "vision"]).default("template") }).strict().superRefine((v, ctx) => { if (new Set(v.sections.map(s => s.id)).size !== v.sections.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_SECTION" }); });
export const THEMES = {
  linen: { background: "#eeebe3", text: "#383a31", muted: "#717362", accent: "#9a7250" }, sand: { background: "#e7decd", text: "#423728", muted: "#806e57", accent: "#a87843" }, red: { background: "#ab111e", text: "#fff4e8", muted: "#edc5c6", accent: "#ffcfa8" }, ice: { background: "#dbe9ed", text: "#27434d", muted: "#55717a", accent: "#8d6345" }, mono: { background: "#eaeaea", text: "#202627", muted: "#5e6565", accent: "#727e7d" }, citrus: { background: "#f0b22d", text: "#53371d", muted: "#77532c", accent: "#984b1a" }, dark: { background: "#17191a", text: "#f0ede6", muted: "#acafa6", accent: "#cbb78d" },
};
export const outputWidth = platform => ({ taobao: 750, amazon: 970, shopify: 1200 })[platform] || 750;
