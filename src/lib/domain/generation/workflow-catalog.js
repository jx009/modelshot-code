const shot = (id, title, direction, options = {}) => Object.freeze({
  id,
  role: options.role || id,
  title,
  direction,
  group: options.group || "main",
  sequence: options.sequence || 1,
  aspectRatio: options.aspectRatio || null,
  mode: options.mode || "product",
  references: options.references || ["product", "detail", "style", "layout", "scene"],
  allowText: options.allowText || false,
  includeBase: options.includeBase ?? true,
});

const MAIN_GALLERY = Object.freeze([
  shot("hero", "Clean product hero", "Create a premium storefront hero image. Isolate the exact product, use a clean commercial background, confident lighting and generous negative space.", { sequence: 1, aspectRatio: "1:1" }),
  shot("feature", "Feature spotlight", "Show the product from its most persuasive angle and make one visible design feature the clear focal point.", { sequence: 2, aspectRatio: "1:1" }),
  shot("lifestyle", "Lifestyle scene", "Place the exact product in a believable aspirational use scene suited to its category and target audience.", { sequence: 3, aspectRatio: "4:3" }),
  shot("detail", "Material detail", "Create a close macro composition that reveals real surface, material, finish and craftsmanship from the references.", { sequence: 4, aspectRatio: "1:1", references: ["product", "detail"] }),
  shot("scale", "Scale and context", "Show the exact product at an immediately understandable scale in a restrained real-world context.", { sequence: 5, aspectRatio: "1:1" }),
]);

const DETAIL_PAGE = Object.freeze([
  shot("detail-cover", "Detail page cover", "Design the opening screen of a premium e-commerce detail page: strong product presence, clear hierarchy and a focused value proposition.", { group: "detail", sequence: 1, aspectRatio: "3:4", allowText: true }),
  shot("detail-benefits", "Core benefits", "Design a benefit-led detail-page screen with the product as the visual anchor and room for concise verified selling points.", { group: "detail", sequence: 2, aspectRatio: "3:4", allowText: true }),
  shot("detail-material", "Materials and craft", "Design a detail-page screen focused on verified materials, finish and construction. Use close-ups only when supported by a reference.", { group: "detail", sequence: 3, aspectRatio: "3:4", allowText: true, references: ["product", "detail", "layout"] }),
  shot("detail-use", "Use scenario", "Design a detail-page screen that demonstrates a credible use scenario and the practical value of the exact product.", { group: "detail", sequence: 4, aspectRatio: "3:4", allowText: true }),
  shot("detail-specs", "Product facts", "Design a clean specification screen using only supplied facts. Keep data areas structured, legible and easy to scan.", { group: "detail", sequence: 5, aspectRatio: "3:4", allowText: true, references: ["product", "detail", "layout"] }),
  shot("detail-closing", "Closing conversion screen", "Design the final detail-page screen with a memorable product composition and a concise closing message.", { group: "detail", sequence: 6, aspectRatio: "3:4", allowText: true }),
]);

const CAMPAIGN = Object.freeze([
  shot("campaign-hero-square", "Campaign hero square", "Create a high-impact square campaign key visual with a premium art-directed product composition.", { group: "campaign", sequence: 1, aspectRatio: "1:1", allowText: true }),
  shot("campaign-hero-portrait", "Campaign hero portrait", "Create a portrait campaign key visual for marketplace feeds with a bold product hierarchy.", { group: "campaign", sequence: 2, aspectRatio: "3:4", allowText: true }),
  shot("campaign-story", "Social story", "Create an immersive vertical social story visual with energetic but controlled commercial styling.", { group: "campaign", sequence: 3, aspectRatio: "9:16", allowText: true }),
  shot("campaign-banner", "Store banner", "Create a wide storefront banner with the product clearly readable and safe space for campaign copy.", { group: "campaign", sequence: 4, aspectRatio: "16:9", allowText: true }),
  shot("campaign-benefit", "Benefit poster", "Turn the strongest verified benefit into a focused advertising poster.", { group: "campaign", sequence: 5, aspectRatio: "3:4", allowText: true }),
  shot("campaign-detail", "Craft poster", "Create a tactile macro campaign visual emphasizing authentic material and finish.", { group: "campaign", sequence: 6, aspectRatio: "3:4", references: ["product", "detail", "style"] }),
  shot("campaign-lifestyle", "Lifestyle campaign", "Build an aspirational but credible campaign scene around the exact product and intended audience.", { group: "campaign", sequence: 7, aspectRatio: "4:3" }),
  shot("campaign-minimal", "Minimal campaign", "Create a restrained, design-led campaign visual with strong negative space and precise lighting.", { group: "campaign", sequence: 8, aspectRatio: "1:1" }),
  shot("campaign-color", "Color-led campaign", "Create a vivid color-led product visual while preserving the product's real colors and identity.", { group: "campaign", sequence: 9, aspectRatio: "1:1" }),
  shot("campaign-editorial", "Editorial campaign", "Create a sophisticated editorial product composition with magazine-quality lighting.", { group: "campaign", sequence: 10, aspectRatio: "3:4" }),
  shot("campaign-seasonal", "Seasonal campaign", "Create a tasteful seasonal campaign scene without adding unsupported promotions or claims.", { group: "campaign", sequence: 11, aspectRatio: "3:4", allowText: true }),
  shot("campaign-retarget", "Conversion creative", "Create a direct-response product creative with immediate hierarchy and a clear visual reason to consider the product.", { group: "campaign", sequence: 12, aspectRatio: "1:1", allowText: true }),
]);

const MODEL_SET = Object.freeze([
  shot("front", "Model front view", "Show the same model wearing the exact garment, facing forward in a natural full-body pose.", { sequence: 1, mode: "tryon", references: ["product", "model", "scene"], includeBase: true }),
  shot("three-quarter", "Model three-quarter view", "Show the same model wearing the exact garment in a three-quarter pose, preserving identity and garment construction.", { sequence: 2, mode: "tryon", references: ["product", "model", "scene"], includeBase: true }),
  shot("side", "Model side view", "Show the same model wearing the exact garment from the side with an anatomically natural pose.", { sequence: 3, mode: "tryon", references: ["product", "model", "scene"], includeBase: true }),
  shot("model-detail", "Worn detail", "Create a closer worn-product view on the same model, emphasizing real garment texture and construction.", { sequence: 4, mode: "tryon", references: ["product", "model", "scene", "detail"], includeBase: true }),
]);

const SKU_KIT = Object.freeze([
  shot("hero", "Clean product hero", "Create a clean product-only white-background hero image.", { sequence: 1, references: ["product"], includeBase: false }),
  ...MODEL_SET.slice(0, 3).map((task, index) => Object.freeze({ ...task, sequence: index + 2 })),
  shot("detail", "Material detail", "Create a close product detail showing authentic material, stitching and construction.", { sequence: 5, references: ["product", "detail"], includeBase: false }),
  shot("lifestyle", "Lifestyle model image", "Show the same model wearing the exact garment in a credible lifestyle setting.", { sequence: 6, mode: "tryon", references: ["product", "model", "scene"], includeBase: true }),
]);

const REFERENCE_REMIX = Object.freeze([
  shot("remix-faithful", "Faithful reference remix", "Recreate the reference visual language while replacing its subject with the exact product. Do not copy trademarks or unsupported text.", { group: "remix", sequence: 1, references: ["product", "style", "layout", "scene"] }),
  shot("remix-layout", "Layout variation", "Keep the reference layout logic and create a distinct, polished composition for the exact product.", { group: "remix", sequence: 2, references: ["product", "layout", "style"] }),
  shot("remix-scene", "Scene variation", "Keep the reference mood and art direction while moving the exact product into a fresh compatible scene.", { group: "remix", sequence: 3, references: ["product", "style", "scene"] }),
  shot("remix-bold", "Creative variation", "Create a bolder campaign interpretation guided by the references while preserving product identity.", { group: "remix", sequence: 4, references: ["product", "style", "layout", "scene"] }),
]);

export const WORKFLOWS = Object.freeze([
  { id: "commerce-suite", title: "Commerce launch suite", description: "Five storefront images and six detail-page screens", plan: [...MAIN_GALLERY, ...DETAIL_PAGE] },
  { id: "main-gallery", title: "Storefront gallery", description: "Five conversion-focused product images", plan: MAIN_GALLERY },
  { id: "detail-page", title: "Detail page", description: "Six ordered product-detail screens", plan: DETAIL_PAGE },
  { id: "campaign-pack", title: "Campaign pack", description: "Twelve marketing visuals in multiple formats", plan: CAMPAIGN },
  { id: "reference-remix", title: "Reference remix", description: "Four variations guided by reference art direction", plan: REFERENCE_REMIX },
  { id: "product-polish", title: "Product polish", description: "One precise product cleanup", plan: [shot("polish", "Product polish", "Retouch and refine the exact product image: correct exposure, clean distractions, improve edge quality and retain every real product detail.", { references: ["product", "detail"], includeBase: true })] },
  { id: "model-set", title: "Consistent model set", description: "Four consistent modeled views", plan: MODEL_SET },
  { id: "sku-kit", title: "SKU launch kit", description: "Six product and modeled deliverables", plan: SKU_KIT },
  { id: "single-shot", title: "Single modeled shot", description: "One virtual try-on image", plan: [shot("single", "Single modeled shot", "Create one professional image of the same model wearing the exact garment.", { mode: "tryon", references: ["product", "model", "scene"], includeBase: true })] },
]);

export function getWorkflow(id) {
  return WORKFLOWS.find(workflow => workflow.id === id) || WORKFLOWS.find(workflow => workflow.id === "single-shot");
}

export function workflowNeedsModel(id) {
  return getWorkflow(id).plan.some(task => task.mode === "tryon");
}

function facts(config) {
  const rows = [
    config.productName && `Product name: ${config.productName}`,
    config.productCategory && `Product category: ${config.productCategory}`,
    config.targetAudience && `Target audience: ${config.targetAudience}`,
    config.brandStyle && `Brand style: ${config.brandStyle}`,
    config.productFacts?.material && `Verified material: ${config.productFacts.material}`,
    config.productFacts?.feature && `Verified selling points: ${config.productFacts.feature}`,
  ].filter(Boolean);
  return rows.length ? `Confirmed product brief:\n${rows.join("\n")}` : "No product facts were supplied; infer no materials, measurements, certifications or product claims.";
}

function copyDirection(task, config) {
  if (!task.allowText) return "Do not render typography, logos, watermarks, badges or placeholder text.";
  const copy = [config.headline && `Headline: ${config.headline}`, config.subheadline && `Supporting copy: ${config.subheadline}`].filter(Boolean);
  if (!copy.length) return "Leave intentional copy-safe space but render no words, placeholder text, logos or badges.";
  return `Render only the following supplied copy in ${config.copyLanguage || "the requested language"}; reproduce it exactly and add no other words:\n${copy.join("\n")}`;
}

function referenceDirection(task, config) {
  const roles = new Set((config.referenceImages || []).map(reference => reference.role));
  const available = task.references.filter(role => role !== "product" && roles.has(role));
  if (!available.length) return "Use the first image as the sole source of truth for product identity.";
  return `Additional reference images are labeled by role. Use only these applicable roles: ${available.join(", ")}. Detail references define product construction; style references define visual tone; layout references guide composition; scene references guide environment. Never copy another product from a reference.`;
}

export function buildWorkflowTasks(id, basePrompt = "", config = {}) {
  const workflow = getWorkflow(id);
  const fidelity = "The first reference image is the primary product. Preserve its exact shape, proportions, colors, labels, logo placement, texture and visible construction. Do not invent accessories, variants, packaging, claims or product features.";
  return workflow.plan.map(task => {
    const directions = [
      `Deliverable ${task.sequence}: ${task.title}.`,
      task.direction,
      fidelity,
      facts(config),
      config.platformSpec ? `Target commerce platform: ${config.platformSpec}.` : "",
      config.brandStyle ? `Keep every output coherent with this brand direction: ${config.brandStyle}.` : "",
      task.includeBase && basePrompt ? `Additional art direction: ${basePrompt}` : "",
      referenceDirection(task, config),
      copyDirection(task, config),
      `Compose for ${task.aspectRatio || config.aspectRatio || "3:4"}. Produce one finished image only.`,
    ].filter(Boolean);
    return { ...task, workflowId: workflow.id, aspectRatio: task.aspectRatio || config.aspectRatio || "3:4", prompt: directions.join("\n\n") };
  });
}

export function workflowOutputCount(id, productCount = 1, variants = 1) {
  return getWorkflow(id).plan.length * productCount * variants;
}
