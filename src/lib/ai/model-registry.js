/**
 * 模型注册表 — 纯数据声明，不导入任何 Adapter
 *
 * 设计灵感：OpenTryOn registry.py 的 ModelSpec 模式
 * 每个 model 声明：谁在哪（importPath）、叫什么（className）、
 * 怎么调（method）、花多少钱（costPerImage）、需要什么参数（params）
 *
 * 新增模型：只在这里加一条，写一个 Adapter 文件 → 完事
 */

export const MODELS = {
  // ===== GPT Image 2（默认主力）=====
  "openai": {
    id: "openai",
    label: "GPT Image 2",
    importPath: "./adapters/openai.js",
    className: "OpenAIAdapter",
    method: "generateTryOn",
    envHint: "OPENAI_API_KEY",
    costPerImage: {
      "1024x1024": { low: 0.02, medium: 0.04, high: 0.08 },
      "1024x1536": { low: 0.02, medium: 0.05, high: 0.11 },
      "1536x1024": { low: 0.02, medium: 0.05, high: 0.11 },
    },
    capabilities: ["tryon", "inpaint", "edit"],
    maxRefImages: 16,
    params: [
      { name: "size", type: "enum", choices: ["1024x1024", "1024x1536", "1536x1024"], default: "1024x1536" },
      { name: "quality", type: "enum", choices: ["low", "medium", "high"], default: "high" },
    ],
    notes: "综合最强，多图参考（16张），官方已支持虚拟试穿 use case",
  },

  // ===== Gemini Image（省钱通道）=====
  "gemini": {
    id: "gemini",
    label: "Gemini Flash Image",
    importPath: "./adapters/gemini.js",
    className: "GeminiAdapter",
    method: "generateTryOn",
    envHint: "GOOGLE_GEMINI_API_KEY",
    costPerImage: 0.04,
    capabilities: ["tryon", "edit"],
    maxRefImages: 4,
    params: [
      { name: "model", type: "enum", choices: ["gemini-2.0-flash-preview-image-generation"], default: "gemini-2.0-flash-preview-image-generation" },
    ],
    notes: "速度快（~4s），成本最低，多角色一致性不错",
  },

  // ===== FASHN.ai（高保真试穿专用）=====
  "fashn": {
    id: "fashn",
    label: "FASHN.ai Try-On",
    importPath: "./adapters/fashn.js",
    className: "FASHNAdapter",
    method: "generateTryOn",
    envHint: "FASHN_API_KEY",
    costPerImage: 0.05,
    capabilities: ["tryon"],
    maxRefImages: 2,
    params: [
      { name: "category", type: "enum", choices: ["auto", "tops", "bottoms", "one-pieces"], default: "auto" },
    ],
    notes: "1800万试穿数据训练，服装保真最好，专业虚拟试穿",
  },
};

/**
 * 全局配置
 */
export const REGISTRY_CONFIG = {
  defaultProvider: process.env.DEFAULT_MODEL_PROVIDER || "openai",
  fallbackOrder: ["openai", "gemini", "fashn"],
};

/**
 * 辅助函数
 */
export function getModel(id) {
  const spec = MODELS[id];
  if (!spec) throw new Error(`Unknown model provider: ${id}. Available: ${Object.keys(MODELS).join(", ")}`);
  return spec;
}

export function listModels() {
  return Object.values(MODELS).map(m => ({
    id: m.id,
    label: m.label,
    capabilities: m.capabilities,
    configured: isConfigured(m),
    notes: m.notes,
  }));
}

export function isConfigured(spec) {
  const envVars = spec.envHint.split(",").map(s => s.trim());
  return envVars.some(v => !!process.env[v]);
}
