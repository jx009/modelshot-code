// Client-safe tool metadata. Validation schemas stay in tools.js so the editor
// does not download zod and commerce schemas just to render controls.
export const TOOLS = [
  { id: "generate", zh: "生成图片", en: "Generate image", dependency: "image", cost: 18, source: false },
  { id: "edit", zh: "参考图编辑", en: "Edit image", dependency: "image", cost: 18, source: true },
  { id: "expand", zh: "AI 扩图", en: "AI expand", dependency: "image", cost: 18, source: true },
  { id: "upscale", zh: "AI 超清放大", en: "AI upscale", dependency: "upscale", cost: 4, source: true },
  { id: "describe", zh: "反推提示词", en: "Reverse prompt", dependency: "vision", cost: 1, source: true },
  { id: "erase", zh: "AI 智能消除", en: "AI erase", dependency: "image", cost: 18, source: true, mask: true },
  { id: "inpaint", zh: "局部修改", en: "Local edit", dependency: "image", preview: "segment", previewOptional: true, cost: 18, source: true, mask: true },
  { id: "split", zh: "图层拆分", en: "Split layers", dependency: "split", cost: 20, source: true },
  { id: "move", zh: "物体移动", en: "Move object", dependency: "image", cost: 18, source: true, mask: true },
  { id: "ocr", zh: "文字识别", en: "Recognize text", dependency: "ocr", cost: 1, source: true },
  { id: "remove-bg", zh: "一键抠图", en: "Remove background", dependency: "remove-bg", cost: 2, source: true },
  { id: "crop", zh: "图片裁剪", en: "Crop image", dependency: "local", cost: 0, source: true },
  { id: "video", zh: "生成视频", en: "Generate video", dependency: "video", cost: 60, source: true },
];

export const getTool = id => TOOLS.find(tool => tool.id === id);
