// Shared, credential-free channel metadata for the administrator and workbench.
export const STUDIO_KINDS = ["openai", "dashscope", "volcengine", "fal"];
export const CHANNEL_CAPABILITIES = ["image", "segment", "split", "language"];
export const CHANNEL_PRESETS = [
  { label: "阿里百炼 · Qwen 图像编辑", kind: "dashscope", studioCapability: "image", imageMode: "edit", model: "qwen-image-edit-max", baseURL: "https://dashscope.aliyuncs.com" },
  { label: "阿里百炼 · Qwen 生成与编辑", kind: "dashscope", studioCapability: "image", imageMode: "both", model: "qwen-image-2.0-pro", baseURL: "https://dashscope.aliyuncs.com" },
  { label: "火山方舟 · Seedream", kind: "volcengine", studioCapability: "image", imageMode: "both", model: "", baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
  { label: "fal · SAM 3 物体分割", kind: "fal", studioCapability: "segment", model: "fal-ai/sam-3/image", baseURL: "https://fal.run" },
  { label: "fal · Qwen 图层拆分", kind: "fal", studioCapability: "split", model: "fal-ai/qwen-image-layered", baseURL: "https://fal.run" },
  { label: "OpenAI 兼容 · 生成与编辑", kind: "openai", studioCapability: "image", imageMode: "both", model: "", baseURL: "" },
];

export function channelCapability(row, config = JSON.parse(row.config || "{}")) {
  return config.studioCapability || (STUDIO_KINDS.includes(row.kind || row.name) && (row.kind || row.name) !== "fal" ? "image" : null);
}

export function supportsImageTask(config, task) {
  const mode = config.imageMode || "both";
  return mode === "both" || mode === task;
}

export function channelScope(row, config = JSON.parse(row.config || "{}")) {
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
  };
}

export function validChannel(kind, config) {
  if (!STUDIO_KINDS.includes(kind)) return !config.studioCapability;
  const capability = channelCapability({ kind }, config);
  if (!CHANNEL_CAPABILITIES.includes(capability)) return false;
  if (kind === "fal") return ["segment", "split"].includes(capability) && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_/-]+$/.test(config.model || "") && !config.model.includes("..");
  if (capability === "language") return config.scope === "language";
  return capability === "image" && ["both", "generate", "edit"].includes(config.imageMode || "both") && (!config.scope || ["public", "tool"].includes(config.scope)) && (config.scope !== "public" || supportsImageTask(config, "generate"));
}

// Allow official APIs and administrator-configured HTTPS-compatible gateways.
// The endpoint is already an admin-only secret-bearing setting, so do not
// maintain a hostname allowlist that blocks legitimate compatible services.
export function allowedProviderBaseURL(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
