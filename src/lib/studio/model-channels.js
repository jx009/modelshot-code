// Shared, credential-free channel metadata for the administrator and workbench.
export const STUDIO_KINDS = ["openai", "dashscope", "volcengine", "volc-visual", "fal"];
export const CHANNEL_CAPABILITIES = ["image", "segment", "split", "language", "ocr", "upscale"];
export const CHANNEL_PRESETS = [
  { label: "阿里百炼 · Qwen 图像编辑", kind: "dashscope", studioCapability: "image", imageMode: "edit", model: "qwen-image-edit-max", baseURL: "https://dashscope.aliyuncs.com" },
  { label: "阿里百炼 · Qwen 生成与编辑", kind: "dashscope", studioCapability: "image", imageMode: "both", model: "qwen-image-2.0-pro", baseURL: "https://dashscope.aliyuncs.com" },
  { label: "火山方舟 · Seedream", kind: "volcengine", studioCapability: "image", imageMode: "both", model: "", baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
  { label: "火山智能视觉 · EntitySegment 物体分割", kind: "volc-visual", studioCapability: "segment", scope: "tool", model: "entity_seg", baseURL: "https://visual.volcengineapi.com" },
  { label: "fal · SAM 3 物体分割", kind: "fal", studioCapability: "segment", model: "fal-ai/sam-3/image", baseURL: "https://fal.run" },
  { label: "fal · Qwen 图层拆分", kind: "fal", studioCapability: "split", model: "fal-ai/qwen-image-layered", baseURL: "https://fal.run" },
  { label: "OpenAI 兼容 · 生成与编辑", kind: "openai", studioCapability: "image", imageMode: "both", model: "", baseURL: "" },
  { label: "火山方舟 · OCR 文字识别", kind: "volcengine", studioCapability: "ocr", scope: "tool", model: "", baseURL: "https://ark.cn-beijing.volces.com/api/v3", creditCost: 1 },
  { label: "火山智能视觉 · 图片超分 2×", kind: "volc-visual", studioCapability: "upscale", scope: "tool", model: "lens_vida_nnsr", baseURL: "https://visual.volcengineapi.com", creditCost: 4 },
  { label: "OpenAI 兼容 · OCR 文字识别", kind: "openai", studioCapability: "ocr", scope: "tool", model: "", baseURL: "https://api.openai.com/v1", creditCost: 1 },
];

function inferFalCapability(config = {}) {
  // Older installations created fal channels before the capability selector
  // was added. Keep those records usable by deriving the capability from the
  // official model id until an administrator saves them again.
  const model = String(config.model || "").toLowerCase();
  if (model.includes("sam-3") || model.includes("sam3")) return "segment";
  if (model.includes("qwen-image-layered") || model.includes("image-layered")) return "split";
  return null;
}

export function channelCapability(row, config = JSON.parse(row.config || "{}")) {
  const kind = row.kind || row.name;
  if (kind === "volc-visual") return config.studioCapability || "segment";
  return config.studioCapability || (kind === "fal" ? inferFalCapability(config) : STUDIO_KINDS.includes(kind) ? "image" : null);
}

// EntitySegment's label map supports both selecting one object and exporting
// every entity. Reuse the same channel and credentials for both operations.
export function supportsChannelCapability(row, capability, config = JSON.parse(row.config || "{}")) {
  return channelCapability(row, config) === capability || (row.kind || row.name) === "volc-visual" && channelCapability(row, config) === "segment" && capability === "split";
}

export function supportsImageTask(config, task) {
  const mode = config.imageMode || "both";
  return mode === "both" || mode === task;
}

export function channelScope(row, config = JSON.parse(row.config || "{}")) {
  if ((row.kind || row.name) === "volc-visual" || ["ocr", "upscale"].includes(channelCapability(row, config))) return "tool";
  if (channelCapability(row, config) === "language") return "language";
  return config.scope || (channelCapability(row, config) === "image" && supportsImageTask(config, "generate") ? "public" : "tool");
}

export function toolRouting(tool, row) {
  return {
    mode: tool.dependency === "image" ? "inherit" : tool.dependency === "local" ? "code" : tool.dependency === "vision" ? "language" : tool.dependency === "split" ? "dedicated" : "service",
    channelName: tool.dependency === "split" ? row?.channelName || null : null,
    segmentMode: row?.channelName && tool.preview === "segment" ? "dedicated" : "default",
    segmentChannelName: tool.preview === "segment" ? row?.channelName || null : null,
    ...row?.routing,
    ...(["ocr", "upscale"].includes(tool.dependency) ? { mode: "dedicated", channelName: row?.routing?.channelName || row?.channelName || null } : {}),
    ...(row?.routing?.segmentMode === "local" ? { segmentMode: "default", segmentChannelName: null } : {}),
  };
}

export function validChannel(kind, config) {
  if (!STUDIO_KINDS.includes(kind)) return !config.studioCapability;
  const capability = channelCapability({ kind }, config);
  if (!CHANNEL_CAPABILITIES.includes(capability)) return false;
  if (kind === "volc-visual") return config.scope === "tool" && (capability === "segment" && config.model === "entity_seg" || capability === "upscale" && config.model === "lens_vida_nnsr");
  if (kind === "fal") return ["segment", "split"].includes(capability) && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_/-]+$/.test(config.model || "") && !config.model.includes("..");
  if (capability === "language") return config.scope === "language";
  if (capability === "ocr") return ["openai", "volcengine"].includes(kind) && config.scope === "tool" && Boolean(config.model?.trim());
  return capability === "image" && ["both", "generate", "edit"].includes(config.imageMode || "both") && (!config.scope || ["public", "tool"].includes(config.scope)) && (config.scope !== "public" || supportsImageTask(config, "generate"));
}

export function segmentChannelReady(channel) {
  return channel?.kind === "volc-visual" ? Boolean(channel.model === "entity_seg" && channel.accessKeyId && channel.secretAccessKey) : Boolean(channel?.kind === "fal" && channel.apiKey);
}

export function ocrChannelReady(channel) {
  return Boolean(["openai", "volcengine"].includes(channel?.kind) && channel.apiKey && channel.model);
}

export function upscaleChannelReady(channel) {
  return Boolean(channel?.kind === "volc-visual" && channel.model === "lens_vida_nnsr" && channel.accessKeyId && channel.secretAccessKey);
}

export function splitChannelReady(channel) {
  return channel?.kind === "volc-visual" ? segmentChannelReady(channel) : Boolean(channel?.kind === "fal" && channel.apiKey);
}

// ROOT configures trusted upstreams, including self-hosted HTTP gateways.
// This validates configuration syntax; never use it for user-supplied media URLs.
export function allowedProviderBaseURL(value) {
  if (!value) return true;
  try {
    const normalized = value.trim();
    if (!/^https?:\/\//i.test(normalized) || /[\s\\]/.test(normalized)) return false;
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
