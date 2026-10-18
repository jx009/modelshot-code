import { IMAGE_RESOLUTIONS, imageSizeChoice } from "./image-size.js";
import { GUIDED_EDIT_TOOLS, editOutputSize } from "./edit-geometry.js";

// Legacy portrait/landscape dimensions are 1K, matching the size picker.
// Aspect ratio does not change the resolution tier selected by the user.
export function resolutionSurcharges(value, fallback = 0) {
  if (!value || typeof value !== "object") value = {};
  return Object.fromEntries(IMAGE_RESOLUTIONS.map(resolution => [resolution,
    Number.isSafeInteger(value[resolution]) && value[resolution] >= 0 ? value[resolution] : fallback,
  ]));
}

export function imageCreditCost(offer, size, fallback = 18) {
  const base = offer?.creditCost ?? offer?.cost ?? fallback;
  const surcharges = resolutionSurcharges(offer?.resolutionSurcharges);
  return base + surcharges[billingResolution(offer, size)];
}

export function billingResolution(offer, size) {
  const requested = imageSizeChoice(size).resolution;
  return offer?.billingResolutions?.[requested] || requested;
}

// Guided edits can adapt to provider limits (e.g. Ark 1K -> 2K, legacy
// Qwen edits -> 1K). Quote the tier actually sent upstream, in both UIs and jobs.
export function imageBillingResolutions(toolId, config) {
  if (!GUIDED_EDIT_TOOLS.includes(toolId)) return null;
  return Object.fromEntries(IMAGE_RESOLUTIONS.map(resolution => [resolution,
    imageSizeChoice(editOutputSize(config, `auto@${resolution}`, { width: 1024, height: 1024 }).choice).resolution,
  ]));
}
