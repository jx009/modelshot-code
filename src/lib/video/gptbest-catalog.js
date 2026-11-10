// GPT-Best's video protocols are distinct even when they share the same host.
// Paths are code-owned; model IDs and optional model settings belong to the admin.
const entry = (id, label, family, path, mediaLimits = { image: 1 }, extra = {}) => ({ id, label, family, path, mediaLimits: { image: 0, video: 0, audio: 0, ...mediaLimits }, ...extra });
export const GPTBEST_VIDEO_APIS = [
  entry("unified-veo", "统一格式 · Veo", "unified", "/v2/videos/generations", { image: 3 }, { ratioField: "aspect_ratio", noDuration: true, durations: [8], ratios: ["16:9", "9:16"] }),
  entry("unified-wan", "统一格式 · Wan", "unified", "/v2/videos/generations", { image: 2, audio: 1 }, { wan: true }),
  entry("unified-grok", "统一格式 · Grok", "unified", "/v2/videos/generations", { image: 3 }, { ratioField: "ratio" }),
  entry("unified-seedance", "统一格式 · Seedance 1 / 2", "unified", "/v2/videos/generations", { image: 9, video: 3, audio: 3 }, { ratioField: "ratio" }),
  entry("unified-sora", "统一格式 · Sora 2 / 故事板 / 角色", "unified", "/v2/videos/generations", { image: 1 }, { ratioField: "aspect_ratio", durationString: true, durations: [10, 15], ratios: ["16:9", "9:16"] }),
  entry("sora", "Sora · 标准 Videos 表单", "videos", "/v1/videos", { image: 1 }, { durations: [4, 8, 12], ratios: ["16:9", "9:16"] }),
  entry("sora-remix", "Sora · Remix", "videos", "/v1/videos/{sourceTaskId}/remix", {}, { fields: [{ key: "sourceTaskId", label: "原视频任务 ID", required: true }] }),
  entry("grok-form", "Grok 1.5 · Videos 表单", "videos", "/v1/videos", { image: 3 }, { form: "grok" }),
  entry("minimax-h3", "MiniMax H3 · Videos 表单", "videos", "/v1/videos", { image: 9, video: 3, audio: 3 }, { form: "h3" }),
  entry("veo-omni", "Veo Omni · Videos 表单", "videos", "/v1/videos", { image: 7, video: 7 }, { form: "omni", maxTotalMedia: 7 }),
  entry("wan3", "Wan 3 · Videos JSON", "videos", "/v1/videos", { image: 9, video: 3, audio: 3 }, { json: true }),
  entry("higgsfield", "Higgsfield · 视频生成", "higgsfield", "/higgsfield/generate", { image: 1 }, { minMedia: { image: 1 }, fields: [{ key: "motion_id", label: "镜头动作模板 ID", required: true }] }),
  entry("higgsfield-speech", "Higgsfield · 说话视频", "higgsfield", "/higgsfield/speech", { image: 1, audio: 1 }, { minMedia: { image: 1 }, fields: [{ key: "avatar_preset_id", label: "数字人模板 ID", required: true }] }),
  entry("higgsfield-ads", "Higgsfield · 广告植入", "higgsfield", "/higgsfield/ads", { image: 1 }, { minMedia: { image: 1 }, fields: [{ key: "product_placement_sample_id", label: "广告模板 ID", required: true }] }),
  entry("pixverse", "PixVerse · 文生 / 图生视频", "pixverse", "/pixverse/v1/pro/generate"),
  entry("luma", "Luma · 视频生成", "luma", "/luma/generations", { image: 2 }),
  entry("luma-async", "Luma · 异步生成", "luma", "/luma/generations_sync", { image: 2 }),
  entry("luma-extend", "Luma · 视频延长", "luma", "/luma/generations/{sourceTaskId}/extend", { image: 2 }, { fields: [{ key: "sourceTaskId", label: "原视频任务 ID", required: true }] }),
  entry("runway-native", "Runway · 官方格式", "runway-native", "/runwayml/v1/image_to_video", { image: 2 }, { minMedia: { image: 1 } }),
  entry("runway", "Runway · 简化生成", "runway", "/runway/v1/pro/generate", { image: 1 }, { fields: [{ key: "style", label: "风格 ID", required: true }] }),
  entry("runway-v2v", "Runway · 视频转视频", "runway", "/runway/v1/pro/video2video", { video: 1 }, { minMedia: { video: 1 } }),
  entry("runway-act", "Runway · Act Two 动作迁移", "runway", "/runway/v1/pro/act_two", { image: 1, video: 2 }, { minMedia: { video: 1 } }),
  entry("runway-aleph", "Runway · Aleph 编辑", "runway", "/runway/v1/pro/aleph", { image: 3, video: 1 }, { minMedia: { video: 1 } }),
  entry("pika", "Pika · 生成 / 特效", "pika", "/pika/generate", { image: 1, video: 1 }),
  entry("minimax", "MiniMax · 原生文生 / 首尾帧", "minimax", "/minimax/v1/video_generation", { image: 2 }),
  ...["text2video", "img2video", "reference2video", "start-end2video"].map((action, index) => entry(`vidu-${action}`, `Vidu · ${["文生", "图生", "参考图", "首尾帧"][index]}`, "vidu", `/vidu/v2/${action}`, { image: index === 0 ? 0 : index === 2 ? 7 : 2 }, { minMedia: { image: index === 0 ? 0 : index === 3 ? 2 : 1 } })),
  entry("seedance-native", "Seedance · 官方多模态格式", "seedance", "/seedance/v3/contents/generations/tasks", { image: 9, video: 3, audio: 3 }),
  entry("xai", "Grok XAI · 文生 / 图生", "xai", "/xai/v1/videos/generations"),
  entry("xai-reference", "Grok XAI · 多图参考", "xai", "/xai/v1/videos/generations", { image: 3 }, { minMedia: { image: 1 } }),
  entry("xai-edit", "Grok XAI · 视频编辑", "xai", "/xai/v1/videos/edits", { video: 1 }, { minMedia: { video: 1 } }),
  entry("xai-extend", "Grok XAI · 视频延长", "xai", "/xai/v1/videos/extensions", { video: 1 }, { minMedia: { video: 1 } }),
  ...[
    ["text", "文生", "video-generation", {}], ["image", "首帧", "video-generation", { image: 1 }],
    ["frames", "首尾帧", "image2video", { image: 2 }], ["reference", "多图参考", "video-generation", { image: 3 }],
    ["move", "图像动起来", "image2video", { image: 1, video: 1 }], ["mix", "人物替换", "image2video", { image: 1, video: 1 }],
    ["animate", "AnimateAnyone", "image2video", { image: 1 }], ["s2v", "音频驱动", "image2video", { image: 1, audio: 1 }],
    ["emo", "EMO", "image2video", { image: 1, audio: 1 }], ["liveportrait", "LivePortrait", "image2video", { image: 1, audio: 1 }],
    ["emoji", "Emoji", "image2video", { image: 1 }], ["edit", "通用编辑", "video-generation", { image: 3, video: 1 }],
    ["retalk", "VideoRetalk", "image2video", { image: 1, video: 1, audio: 1 }], ["style", "风格重绘", "video-generation", { video: 1 }],
  ].map(([action, label, group, media]) => entry(`qwen-${action}`, `万相原生 · ${label}`, "qwen", `/qwen/api/v1/services/aigc/${group}/video-synthesis`, media,
    { minMedia: { ...(media.image && !["edit", "retalk"].includes(action) ? { image: action === "frames" ? 2 : 1 } : {}), ...(media.video ? { video: 1 } : {}), ...(media.audio ? { audio: 1 } : {}) },
      ...(action === "animate" ? { fields: [{ key: "template_id", label: "动作模板 ID", required: true }] } : {}),
      ...(action === "emoji" ? { fields: [{ key: "driven_id", label: "表情模板 ID", required: true }] } : {}) })),
  ...[
    ["text2video", "文生视频", {}], ["image2video", "首尾帧", { image: 2 }], ["multi-image2video", "多图参考", { image: 4 }],
    ["omni-video", "Omni", { image: 7, video: 1 }], ["motion-control", "动作控制", { image: 1, video: 1 }],
    ["video-extend", "延长", {}], ["avatar/image2video", "数字人", { image: 1, audio: 1 }],
    ["lip-sync", "对口型", { video: 1, audio: 1 }], ["effects", "视频特效", { image: 2 }],
  ].map(([action, label, media]) => entry(`kling-${action.replaceAll("/", "-")}`, `可灵原生 · ${label}`, "kling", `/kling/v1/videos/${action}`, media,
    { minMedia: action === "omni-video" ? {} : { ...(media.image ? { image: 1 } : {}), ...(media.video ? { video: 1 } : {}), ...(media.audio ? { audio: 1 } : {}) },
      ...(action === "video-extend" ? { fields: [{ key: "video_id", label: "原视频 ID", required: true }] } : {}),
      ...(action === "effects" ? { fields: [{ key: "effect_scene", label: "特效模板名称", required: true }] } : {}) })),
];

export function gptBestApi(id = "unified-seedance") { return GPTBEST_VIDEO_APIS.find(api => api.id === id); }

export function validVideoParameters(value) {
  if (!value || Array.isArray(value) || typeof value !== "object" || JSON.stringify(value).length > 16000) return false;
  const safe = (item, depth) => depth <= 8 && (item === null || ["string", "number", "boolean"].includes(typeof item) || Array.isArray(item) && item.every(child => safe(child, depth + 1))
    || typeof item === "object" && Object.entries(item).every(([key, child]) => !["__proto__", "constructor", "prototype"].includes(key) && !/key|secret|authorization|token/i.test(key) && safe(child, depth + 1)));
  return safe(value, 0);
}

export function publicVideoOptions(options) {
  if (!options?.api) return options;
  const { parameters, variants, ...rest } = options;
  return { ...rest, ...(variants ? { variants: variants.map(({ parameters: variantParameters, ...variant }) => ({ ...variant, configuredFields: Object.keys(variantParameters || {}).filter(key => variantParameters[key]) })) } : {}), configuredFields: Object.keys(parameters || {}).filter(key => parameters[key]) };
}

export function gptBestInputError(options, { media = [], videoFields = {}, hasImage = false } = {}) {
  const api = gptBestApi(options.api);
  if (!api) return "VIDEO_PROTOCOL_UNSUPPORTED";
  if (api.maxTotalMedia && media.length > api.maxTotalMedia || api.id === "kling-omni-video" && media.some(item => item.type === "video") && media.filter(item => item.type === "image").length > 4) return "VIDEO_MEDIA_LIMIT";
  for (const [type, minimum] of Object.entries(api.minMedia || {})) {
    const count = media.filter(item => item.type === type).length || (type === "image" && hasImage ? 1 : 0);
    if (count < minimum) return "VIDEO_REFERENCE_REQUIRED";
  }
  if ((api.fields || []).some(field => field.required && !videoFields[field.key]?.trim() && !options.parameters?.[field.key] && !options.configuredFields?.includes(field.key))) return "VIDEO_FIELDS_REQUIRED";
  if (Object.keys(videoFields).some(key => !(api.fields || []).some(field => field.key === key))) return "VIDEO_FIELDS_INVALID";
  if (Object.entries(videoFields).some(([key, value]) => value && options.fieldChoices?.[key] && !options.fieldChoices[key].some(choice => choice.value === value))) return "VIDEO_FIELDS_INVALID";
  return null;
}
