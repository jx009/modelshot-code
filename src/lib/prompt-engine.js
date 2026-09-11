/**
 * Prompt 模板引擎
 * 用户不写 prompt——系统根据选择自动组装
 */

const BASE_TEMPLATES = {
  top: `A professional fashion photo of a {{gender}} model wearing the exact garment shown in the reference image. The garment is a {{garmentDesc}}. {{sceneDesc}} The model has {{modelDesc}}. The garment must be faithfully reproduced: accurate color, fabric texture, pattern/logo placement, and fit. Photo-realistic, e-commerce quality, sharp focus, even lighting.`,

  bottom: `A professional fashion photo of a {{gender}} model wearing the exact pants/skirt shown in the reference image. {{sceneDesc}} The model has {{modelDesc}}. Accurate reproduction of: fabric drape, waistline, length, and any design details. Photo-realistic, e-commerce quality.`,

  dress: `A professional fashion photo of a {{gender}} model wearing the exact dress shown in the reference image. {{sceneDesc}} The model has {{modelDesc}}. Full-length view showing accurate silhouette, fabric flow, neckline, and pattern. Photo-realistic, e-commerce quality.`,

  outerwear: `A professional fashion photo of a {{gender}} model wearing the exact coat/jacket shown in the reference image over a simple top. {{sceneDesc}} The model has {{modelDesc}}. Show accurate collar, closure, sleeve length, and material texture. Photo-realistic.`,

  swimwear: `A professional fashion photo of a {{gender}} model wearing the exact swimwear shown in the reference image. {{sceneDesc}} The model has {{modelDesc}}. Accurate reproduction of cut, color, and pattern. Photo-realistic, tasteful e-commerce photography.`,
};

const SCENE_PROMPTS = {
  white: "Clean white studio background, professional product photography lighting.",
  street: "Urban street setting, natural daylight, blurred city background.",
  indoor: "Modern indoor setting, warm ambient lighting, minimalist furniture.",
  outdoor: "Outdoor natural setting, golden hour lighting, soft bokeh background.",
  studio: "Professional photography studio, three-point lighting setup.",
};

const PLATFORM_SUFFIXES = {
  amazon: " White background, product fills 85% of frame, sRGB color space.",
  tiktok: " Vertical 9:16 composition, vibrant colors, lifestyle setting.",
  taobao: " Clean composition, bright lighting, product-focused.",
  shein: " Trendy styling, lifestyle shot, model looking at camera.",
};

/* ═══ 摄影维度（Click-driven directorial control，行业范式）═══ */
const POSE_PROMPTS = {
  standing: "Standing relaxed, natural weight shift, arms resting at sides.",
  walking: "Mid-stride walking pose, natural movement, slight motion in the garment.",
  three_quarter: "Three-quarter turn to camera, one hand relaxed on hip.",
  sitting: "Seated on a minimal stool, legs angled, posture upright.",
  leaning: "Leaning casually against a clean wall, shoulders relaxed.",
  closeup: "Waist-up crop, torso slightly angled toward camera.",
};

const CAMERA_PROMPTS = {
  eye_level: "Eye-level camera, natural perspective.",
  low_angle: "Slightly low camera angle, elongating the figure.",
  high_angle: "Slightly high camera angle, compact flattering crop.",
  full_body: "Full-body framing, head to toe in frame with breathing room.",
};

const LIGHTING_PROMPTS = {
  soft: "Soft diffused studio lighting, even shadows, true-to-color rendering.",
  natural: "Natural window light, gentle falloff, airy feel.",
  editorial: "Editorial hard light, sculpted shadows, subtle contrast.",
  golden: "Warm golden-hour tone, soft rim light.",
};

function buildModelDesc(modelPreset) {
  if (!modelPreset) return "a natural, professional look";
  const parts = [];
  if (modelPreset.ethnicity) parts.push(`${modelPreset.ethnicity} ethnicity`);
  if (modelPreset.bodyType && modelPreset.bodyType !== "standard") parts.push(`${modelPreset.bodyType} body type`);
  return parts.length ? parts.join(", ") : "a natural, professional look";
}

/**
 * 组装 Prompt
 * 模板优先级：DB PromptTemplate（Admin 在线可编辑，实时生效）> 硬编码 BASE_TEMPLATES 兜底
 * 摄影维度（姿态/相机/光线）在模板之后追加——模板可编辑不必感知这三个占位符
 *
 * @param {Object} opts
 * @param {string} opts.garmentType    - top | bottom | dress | outerwear | swimwear
 * @param {Object} opts.modelPreset    - ModelPreset 记录（可空）
 * @param {Object} opts.scenePreset    - ScenePreset 记录（可空）
 * @param {string} opts.platformSpec   - amazon | tiktok | taobao | shein（可空）
 * @param {string} opts.userPrompt     - 用户自定义 prompt（可空，优先级最高）
 * @param {string} opts.pose           - standing | walking | three_quarter | sitting | leaning | closeup（可空）
 * @param {string} opts.camera         - eye_level | low_angle | high_angle | full_body（可空）
 * @param {string} opts.lighting       - soft | natural | editorial | golden（可空）
 */
export async function buildPrompt({ garmentType, modelPreset, scenePreset, platformSpec, userPrompt, pose, camera, lighting }) {
  const type = garmentType || "top";
  let template = BASE_TEMPLATES[type] || BASE_TEMPLATES.top;

  // DB 模板优先（Admin 后台编辑后实时生效）
  try {
    const { getPromptTemplate } = await import("./prompt-template-store.js");
    const dbTemplate = await getPromptTemplate(type);
    if (dbTemplate) template = dbTemplate;
  } catch (err) {
    console.warn("[PromptEngine] DB template lookup failed, using built-in:", err.message);
  }

  let sceneDesc = SCENE_PROMPTS[scenePreset?.category] || SCENE_PROMPTS.white;
  if (scenePreset?.promptSnippet) sceneDesc = scenePreset.promptSnippet;

  let prompt = template
    .replace(/\{\{gender\}\}/g, modelPreset?.gender === "male" ? "male" : "female")
    .replace(/\{\{garmentDesc\}\}/g, type)
    .replace(/\{\{sceneDesc\}\}/g, sceneDesc)
    .replace(/\{\{modelDesc\}\}/g, buildModelDesc(modelPreset));

  // 摄影维度追加（模板之后、平台后缀之前，保持 prompt 结构稳定）
  if (pose && POSE_PROMPTS[pose]) prompt += ` ${POSE_PROMPTS[pose]}`;
  if (camera && CAMERA_PROMPTS[camera]) prompt += ` ${CAMERA_PROMPTS[camera]}`;
  if (lighting && LIGHTING_PROMPTS[lighting]) prompt += ` ${LIGHTING_PROMPTS[lighting]}`;
  if (userPrompt?.trim()) prompt += ` Additional direction: ${userPrompt.trim()}`;

  if (platformSpec && PLATFORM_SUFFIXES[platformSpec]) {
    prompt += PLATFORM_SUFFIXES[platformSpec];
  }
  return prompt;
}

/**
 * aspectRatio → 模型 size 参数
 */
export function aspectRatioToSize(ratio) {
  const map = {
    "1:1": "1024x1024",
    "3:4": "1024x1536",
    "4:3": "1536x1024",
    "9:16": "1024x1536",
    "16:9": "1536x1024",
  };
  return map[ratio] || "1024x1536";
}
