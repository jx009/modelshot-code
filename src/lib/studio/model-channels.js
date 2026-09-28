// Shared, credential-free channel metadata for the administrator and workbench.
export const STUDIO_KINDS = ["openai", "dashscope", "volcengine", "fal"];
export const CHANNEL_CAPABILITIES = ["image", "segment", "split"];
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

export function validChannel(kind, config) {
  if (!STUDIO_KINDS.includes(kind)) return !config.studioCapability;
  const capability = channelCapability({ kind }, config);
  if (!CHANNEL_CAPABILITIES.includes(capability)) return false;
  if (kind === "fal") return ["segment", "split"].includes(capability) && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_/-]+$/.test(config.model || "") && !config.model.includes("..");
  return capability === "image" && ["both", "generate", "edit"].includes(config.imageMode || "both");
}

// Official origins work without deployment-specific proxy configuration.
// Custom proxies still require an exact administrator-controlled allowlist.
export function allowedProviderBaseURL(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    const official = ["api.openai.com", "dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com", "ark.cn-beijing.volces.com", "fal.run"];
    const workspace = /^[a-zA-Z0-9-]+\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/.test(url.hostname);
    const extra = (process.env.PROVIDER_PROXY_HOSTS || "").split(",").map(host => host.trim());
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === "443") && (official.includes(url.hostname) || workspace || extra.includes(url.hostname));
  } catch { return false; }
}
