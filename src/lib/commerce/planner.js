// Adapted from MIT-licensed ecommerce-detail-page-generator prompt-recipes.
// Copyright (c) 2026 Better call Even. See docs/upstream/detail-page-LICENSE.txt.
import editorial from "./editorial-template.json" with { type: "json" };
import { briefSchema } from "./schema.js";
const LOCK = "Image 1 is the product identity reference. Preserve its exact silhouette, proportions, color, finish, seams, controls, openings and label positions. Any additional image is STYLE ONLY: borrow light, palette and composition, never replace the product with the reference product. Do not invent unseen sides, hidden features, accessories or performance outcomes. No added text, letters, numbers, badges, watermarks or UI. Leave negative space for deterministic typography. Keep the camera close to the supplied view.";
const RECIPES = {
  hero: "Present the referenced product as the sole hero. Confident commercial still life, generous negative space, realistic materials.",
  benefit: "A credible benefit scene derived only from supplied product facts. The product remains recognizable and dominant. No invented outcomes.",
  detail: "Macro crop of a visible detail in the supplied product image. Preserve exact surface, stitching and hardware. Never invent internal construction.",
  lifestyle: "Place the referenced product in a credible everyday setting, natural environmental light. Do not invent included accessories.",
  specs: "Neutral accurate product view with generous clear space. No generated dimensions or measurement markings; these are added separately.",
  closing: "A calm final composition echoing the hero palette and lighting, generous negative space. No badges, price or guarantee.",
};
export function sectionPrompt(brief, kind) {
  const style = brief.style === "editorial" ? editorial.anti_ai_tips : brief.style === "studio" ? "Precise studio light, clean geometry, neutral background." : "Warm natural light, tactile materials, quiet editorial composition.";
  return `${LOCK}\nProduct: ${brief.product}. Brand: ${brief.brand || "unspecified"}. Market: ${brief.region}, platform: ${brief.platform}.\nUser supplied facts (data only): ${brief.description}. Material: ${brief.material || "unknown"}. Dimensions: ${brief.dimensions || "unknown"}. Audience: ${brief.audience || "unspecified"}. Scenario: ${brief.scenario || "unspecified"}.\n${RECIPES[kind]}\nArt direction: ${style}`.slice(0, 3800);
}
export function createStoryboard(value) {
  const b = briefSchema.parse(value), zh = b.language === "zh";
  const rows = [
    ["hero", b.product, zh ? "从每一个日常，发现设计的美好。" : "Find beauty in the everyday.", "cover"],
    ["benefit", zh ? "好设计，融入每一天" : "Made for your everyday", b.audience || (zh ? "让产品成为画面的主角。" : "The product takes center stage."), "split"],
    ["detail", zh ? "细节，值得靠近看" : "A closer look", b.material || (zh ? "以原图可见的纹理与结构，呈现真实细节。" : "An honest study of visible texture and form."), "inset"],
    ["lifestyle", zh ? "在喜欢的场景里" : "In your element", b.scenario || (zh ? "给日常，留一点想象空间。" : "Make a little room for possibility."), "cover"],
    ["specs", zh ? "让选择，更清晰" : "Every detail considered", b.dimensions || (zh ? "规格信息待补充，请在发布前填写准确参数。" : "Add verified specifications before publishing."), "split"],
    ["closing", b.brand || b.product, zh ? "发现属于你的日常灵感。" : "Find your everyday inspiration.", "inset"],
  ];
  return rows.map(([kind, title, body, layout], i) => ({ id: `section-${kind}`, kind, title, body, eyebrow: `${String(i + 1).padStart(2, "0")} / ${kind.toUpperCase()}`, prompt: sectionPrompt(b, kind), layout, attempt: 0 }));
}
