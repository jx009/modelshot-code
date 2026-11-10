import { gptBestApi, gptBestInputError } from "./gptbest-catalog.js";
import { videoReferenceMode, videoReferenceError } from "./references.js";
import { selectVideoVariant } from "./variants.js";

export const VIDEO_KINDS = ["volcengine", "openai", "zzshu", "dashscope", "gptbest"];
export { VIDEO_DURATIONS } from "./constants.js";
export const VIDEO_PROTOCOLS = {
  volcengine: { label: "方舟 / Seedance 兼容", baseURL: "https://ark.cn-beijing.volces.com/api/v3", durations: [5, 10], ratios: ["16:9", "9:16", "1:1", "4:5"], inputMode: "both" },
  openai: { label: "第三方 OpenAI Videos 兼容", baseURL: "", durations: [4, 8, 12], ratios: ["16:9", "9:16"], inputMode: "both" },
  zzshu: { label: "吱吱鼠 · Videos JSON", baseURL: "https://sub.zzshu.cc/v1", durations: [5], ratios: ["16:9", "9:16", "1:1"], inputMode: "both", referenceMode: "reference_images" },
  dashscope: { label: "百炼 / 万相兼容", baseURL: "https://dashscope.aliyuncs.com/api/v1", durations: [5, 10], ratios: ["16:9", "9:16", "1:1"], inputMode: "text" },
  gptbest: { label: "GPT-Best · 视频接口", baseURL: "", durations: [5, 10], ratios: ["16:9", "9:16", "1:1"], inputMode: "both" },
};

export function videoModelOptions(kind = "volcengine", config = {}) {
  const protocol = VIDEO_PROTOCOLS[kind];
  if (!protocol) return null;
  const api = kind === "gptbest" ? gptBestApi(config.videoApi) : null;
  const options = { durations: config.videoDurations?.length ? config.videoDurations : api?.durations || protocol.durations,
    ratios: api?.ratios || protocol.ratios, inputMode: config.videoInputMode || protocol.inputMode,
    ...(kind === "gptbest" ? { api: api?.id, mediaLimits: api?.mediaLimits, fields: api?.fields || [], parameters: config.videoParameters || {}, ...(config.videoVariants?.length ? { variants: config.videoVariants } : {}), ...(config.videoFieldChoices ? { fieldChoices: config.videoFieldChoices } : {}) } : {}),
    ...(kind === "zzshu" ? { referenceMode: config.videoReferenceMode || protocol.referenceMode,
      promptOptional: true, mediaLimits: config.videoReferenceMode === "first_frame" ? { image: 2, video: 0, audio: 0 } : { image: 30, video: 10, audio: 10 } } : {}) };
  return { ...options, referenceLayout: videoReferenceMode(kind, options) };
}

export function videoInputError(options, { duration, ratio = "16:9", hasImage = false, media = [], videoFields = {}, videoVariant }) {
  if (!options) return "VIDEO_PROTOCOL_UNSUPPORTED";
  const selected = selectVideoVariant(options, videoVariant);
  if (selected.error) return selected.error;
  options = selected.options;
  if (!options.durations.includes(duration)) return "VIDEO_DURATION_UNSUPPORTED";
  if (!options.ratios.includes(ratio)) return "VIDEO_RATIO_UNSUPPORTED";
  hasImage ||= media.some(item => item.type === "image");
  if (options.inputMode === "image" && !hasImage) return "VIDEO_REFERENCE_REQUIRED";
  if (options.inputMode === "text" && (hasImage || media.length)) return "VIDEO_REFERENCE_UNSUPPORTED";
  const limits = options.mediaLimits || { image: 1, video: 0, audio: 0 };
  if (["image", "video", "audio"].some(type => media.filter(item => item.type === type).length > (limits[type] || 0))) return "VIDEO_MEDIA_LIMIT";
  const referenceError = videoReferenceError(options, media);
  if (referenceError) return referenceError;
  const audios = media.filter(item => item.type === "audio");
  if (audios.some(item => item.duration < 1.8) || audios.reduce((sum, item) => sum + item.duration, 0) > 30) return "VIDEO_AUDIO_DURATION_INVALID";
  if (options.api) return gptBestInputError(options, { media, videoFields, hasImage });
  if (Object.keys(videoFields).length) return "VIDEO_FIELDS_INVALID";
  return null;
}
