import { imageSizeChoice, resolveImageSize, imageSizeError } from "./image-size.js";

export const GUIDED_EDIT_TOOLS = ["inpaint", "expand"];
export const expansionEdges = padding => typeof padding === "number"
  ? { left: padding, right: padding, top: padding, bottom: padding } : padding;

export function expansionPadding(width, height, ratio) {
  const [a, b] = ratio.split(":").map(Number);
  let units = Math.ceil(Math.max(width / a, height / b));
  if (units * (a + b) - width - height < 32) units = Math.ceil((width + height + 32) / (a + b));
  const x = a * units - width, y = b * units - height;
  if (x > 2048 || y > 2048 || a * units > 8192 || b * units > 8192 || a * b * units ** 2 > 40000000) return null;
  return { left: Math.floor(x / 2), right: Math.ceil(x / 2), top: Math.floor(y / 2), bottom: Math.ceil(y / 2) };
}

// The tool geometry controls aspect ratio; the composer only supplies resolution.
export function editOutputSize(config, size, source) {
  let { resolution } = imageSizeChoice(size);
  if (config.imageKind === "volcengine" && resolution === "1K") resolution = "2K";
  let choice = `auto@${resolution}`;
  // Older official APIs require one of three sizes; editFrame letterboxes without stretching.
  if ((config.imageKind || "openai") === "openai" && !config.baseURL && /^gpt-image-1(?:[.-]|$)/.test(config.imageModel || "")) {
    choice = source.width / source.height > 1.25 ? "1536x1024" : source.height / source.width > 1.25 ? "1024x1536" : "1024x1024";
  }
  if (config.imageKind === "dashscope" && config.imageModel === "qwen-image-edit") choice = "1024x1024";
  return { choice, dimensions: resolveImageSize(choice, source), error: imageSizeError(config, choice, source) };
}

export function editTargetSize(tool, source, padding) {
  if (tool !== "expand") return { width: source.width, height: source.height };
  const edges = expansionEdges(padding);
  return { width: source.width + edges.left + edges.right, height: source.height + edges.top + edges.bottom };
}
