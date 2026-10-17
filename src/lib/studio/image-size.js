// Shared by UI, document validation and provider adapters. Legacy dimensions
// remain valid so opening an existing project never changes its next request.
export const IMAGE_RATIOS = ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "4:5", "5:4", "8:1"];
export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
export const LEGACY_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"];
export const IMAGE_SIZES = [...LEGACY_IMAGE_SIZES, ...IMAGE_RATIOS.flatMap(ratio => IMAGE_RESOLUTIONS.map(resolution => `${ratio}@${resolution}`))];
export function imageSizeChoice(size = "1024x1024") {
  const legacy = { "1024x1024": "1:1", "1024x1536": "2:3", "1536x1024": "3:2" };
  if (legacy[size]) return { ratio: legacy[size], resolution: "1K", legacy: true };
  if (!IMAGE_SIZES.includes(size)) throw new Error("INVALID_IMAGE_SIZE");
  const [ratio, resolution] = size.split("@");
  return { ratio, resolution, legacy: false };
}
export function resolveImageSize(size = "1024x1024", source) {
  const choice = imageSizeChoice(size);
  if (choice.legacy) return size;
  if (choice.resolution === "1K" && choice.ratio === "2:3") return "1024x1536";
  if (choice.resolution === "1K" && choice.ratio === "3:2") return "1536x1024";
  const ratio = choice.ratio === "auto" ? source?.width > 0 && source?.height > 0 ? source.width / source.height : 1 : choice.ratio.split(":").reduce((a, b) => Number(a) / Number(b));
  // K is a square-equivalent pixel budget. Clamp extreme source ratios and
  // the longest edge to the asset pipeline's 8192px limit; expose exact pixels.
  const aspect = Math.max(1 / 8, Math.min(8, ratio));
  const edge = { "1K": 1024, "2K": 2048, "4K": 4096 }[choice.resolution];
  let width = edge * Math.sqrt(aspect), height = edge / Math.sqrt(aspect);
  const scale = Math.min(1, 8192 / Math.max(width, height));
  width = Math.min(8192, Math.round(width * scale / 16) * 16);
  height = Math.min(8192, Math.round(height * scale / 16) * 16);
  return `${width}x${height}`;
}

// Only enforce protocol limits that are known here. Unknown compatible
// gateways still receive the requested size; their rejection must be surfaced.
export function imageSizeError(config, size, source) {
  const dimensions = resolveImageSize(size, source);
  const [width, height] = dimensions.split("x").map(Number);
  if (config.imageKind === "volcengine" && !LEGACY_IMAGE_SIZES.includes(size) && width * height < 3686400) return "IMAGE_RESOLUTION_UNSUPPORTED";
  if (config.imageKind === "dashscope" && config.imageModel === "qwen-image-edit" && !LEGACY_IMAGE_SIZES.includes(size)) return "IMAGE_SIZE_UNSUPPORTED";
  if ((config.imageKind || "openai") === "openai" && !config.baseURL) {
    const model = config.imageModel || "";
    if (/^gpt-image-1(?:[.-]|$)/.test(model) && !LEGACY_IMAGE_SIZES.includes(dimensions)) return "IMAGE_SIZE_UNSUPPORTED";
    if (model === "dall-e-3" && !["1024x1024", "1024x1792", "1792x1024"].includes(dimensions)) return "IMAGE_SIZE_UNSUPPORTED";
    if (model === "dall-e-2" && dimensions !== "1024x1024") return "IMAGE_SIZE_UNSUPPORTED";
  }
  return null;
}
