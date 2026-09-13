import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { decryptSecret } from "../../crypto.js";
import { workflowNeedsModel } from "./workflow-catalog.js";

export const CAPABILITIES = Object.freeze({
  openai: { version: "2", model: "gpt-image-2", controls: ["pose", "camera", "lighting", "scene", "prompt", "references", "copy"], garments: ["top", "bottom", "dress", "outerwear", "swimwear"], productCategories: ["fashion", "beauty", "electronics", "food", "home", "jewelry", "sports", "other"], workflows: "all", nativeSizes: ["1024x1024", "1024x1536", "1536x1024"], query: false, cancel: false },
  gemini: { version: "2", model: "gemini-2.0-flash-preview-image-generation", controls: ["pose", "camera", "lighting", "scene", "prompt", "references", "copy"], garments: ["top", "bottom", "dress", "outerwear", "swimwear"], productCategories: ["fashion", "beauty", "electronics", "food", "home", "jewelry", "sports", "other"], workflows: "all", nativeSizes: [], query: false, cancel: false },
  fashn: { version: "1", model: "tryon-v1.6", controls: [], garments: ["top", "bottom", "dress", "outerwear"], productCategories: ["fashion"], workflows: ["single-shot"], nativeSizes: [], query: true, cancel: false },
});
const ENV_KEYS = { openai: "OPENAI_API_KEY", gemini: "GOOGLE_GEMINI_API_KEY", fashn: "FASHN_API_KEY" };

export async function availableProviders(_userId, db = prisma) {
  const rows = await db.modelProvider.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { priority: "asc" }] });
  return rows.filter(row => CAPABILITIES[row.name]).map(row => {
    const config = JSON.parse(row.config || "{}");
    return { id: row.name, label: row.displayName, ...CAPABILITIES[row.name], model: config.model || CAPABILITIES[row.name].model,
      platformConfigured: Boolean(config.apiKeyEnc || process.env[ENV_KEYS[row.name]]) };
  }).filter(row => row.platformConfigured);
}

export async function resolveProvider(userId, config, db = prisma) {
  const available = await availableProviders(userId, db);
  const selected = config.provider ? available.find(row => row.id === config.provider) : available.find(row => row.platformConfigured);
  if (!selected) throw new AppError("PROVIDER_UNAVAILABLE", 503);
  if (selected.workflows !== "all" && !selected.workflows.includes(config.workflowId)) throw new AppError("UNSUPPORTED_WORKFLOW");
  if (!selected.productCategories.includes(config.productCategory)) throw new AppError("UNSUPPORTED_PRODUCT_CATEGORY");
  if (workflowNeedsModel(config.workflowId) && !selected.garments.includes(config.garmentType)) throw new AppError("UNSUPPORTED_GARMENT");
  for (const control of ["pose", "camera", "lighting", "prompt"]) {
    if (config[control] && !selected.controls.includes(control)) throw new AppError("UNSUPPORTED_CONTROL");
  }
  if (config.scenePresetId && !selected.controls.includes("scene")) throw new AppError("UNSUPPORTED_SCENE");
  return selected;
}

export async function providerAdapter(output, db = prisma) {
  const snapshot = output.snapshot;
  const row = await db.modelProvider.findUnique({ where: { name: snapshot.provider } });
  if (!row?.isActive) throw new AppError("PROVIDER_DISABLED", 503);
  const providerConfig = JSON.parse(row.config || "{}");
  const apiKey = providerConfig.apiKeyEnc ? decryptSecret(providerConfig.apiKeyEnc) : process.env[ENV_KEYS[snapshot.provider]];
  if (!apiKey) throw new AppError("PROVIDER_UNAVAILABLE", 503);
  const config = { apiKey, model: snapshot.model, baseURL: providerConfig.baseURL || undefined };
  if (snapshot.provider === "openai") { const { OpenAIAdapter } = await import("../../ai/adapters/openai.js"); return new OpenAIAdapter(config); }
  if (snapshot.provider === "gemini") { const { GeminiAdapter } = await import("../../ai/adapters/gemini.js"); return new GeminiAdapter(config); }
  if (snapshot.provider === "fashn") { const { FASHNAdapter } = await import("../../ai/adapters/fashn.js"); return new FASHNAdapter(config); }
  throw new AppError("PROVIDER_UNAVAILABLE", 503);
}
