export const VIDEO_KINDS = ["volcengine", "openai", "dashscope"];
export const VIDEO_DURATIONS = [4, 5, 8, 10, 12, 15];
export const VIDEO_PROTOCOLS = {
  volcengine: { label: "方舟 / Seedance 兼容", baseURL: "https://ark.cn-beijing.volces.com/api/v3", durations: [5, 10], ratios: ["16:9", "9:16", "1:1", "4:5"], inputMode: "both" },
  openai: { label: "第三方 OpenAI Videos 兼容", baseURL: "", durations: [4, 8, 12], ratios: ["16:9", "9:16"], inputMode: "both" },
  dashscope: { label: "百炼 / 万相兼容", baseURL: "https://dashscope.aliyuncs.com/api/v1", durations: [5, 10], ratios: ["16:9", "9:16", "1:1"], inputMode: "text" },
};

export function videoModelOptions(kind = "volcengine", config = {}) {
  const protocol = VIDEO_PROTOCOLS[kind];
  if (!protocol) return null;
  return { durations: config.videoDurations?.length ? config.videoDurations : protocol.durations,
    ratios: protocol.ratios, inputMode: config.videoInputMode || protocol.inputMode };
}

export function videoInputError(options, { duration, ratio = "16:9", hasImage = false }) {
  if (!options) return "VIDEO_PROTOCOL_UNSUPPORTED";
  if (!options.durations.includes(duration)) return "VIDEO_DURATION_UNSUPPORTED";
  if (!options.ratios.includes(ratio)) return "VIDEO_RATIO_UNSUPPORTED";
  if (options.inputMode === "image" && !hasImage) return "VIDEO_REFERENCE_REQUIRED";
  if (options.inputMode === "text" && hasImage) return "VIDEO_REFERENCE_UNSUPPORTED";
  return null;
}
