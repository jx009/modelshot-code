import { videoInputError, videoModelOptions } from "./model-protocols.js";
import { selectVideoVariant } from "./variants.js";

export function videoModelOffer(caps, provider, video) {
  const tool = caps?.tools?.find(tool => tool.id === "video");
  const base = tool ? { ...caps?.videoDefaults, ...tool } : undefined;
  const selected = provider || caps?.videoProvider;
  if (!selected) return checkVideoOffer(base, video);
  const model = caps?.videoModels?.find(item => item.id === selected);
  if (!model) return { ...base, available: false, reason: "PROVIDER_CAPABILITY_UNSUPPORTED" };
  return checkVideoOffer({ ...base, provider: model.id, cost: model.cost, available: model.available, reason: model.available ? null : base?.reason, durations: model.durations, ratios: model.ratios, inputMode: model.inputMode, promptOptional: model.promptOptional, referenceMode: model.referenceMode, referenceLayout: model.referenceLayout, mediaLimits: model.mediaLimits, api: model.api, variants: model.variants, fieldChoices: model.fieldChoices, fields: model.fields, configuredFields: model.configuredFields }, video);
}

function checkVideoOffer(offer, video) {
  if (!video || !offer) return offer;
  const options = { ...videoModelOptions(), ...Object.fromEntries(Object.entries(offer).filter(([, value]) => value !== undefined)) };
  const selection = selectVideoVariant(options, video.videoVariant);
  if (selection.variant) offer = { ...offer, cost: selection.variant.creditCost, durations: selection.options.durations, ratios: selection.options.ratios, configuredFields: selection.options.configuredFields };
  const error = videoInputError(options, { ...video, hasImage: video.media?.some(item => item.type === "image") });
  return error && offer.available ? { ...offer, available: false, reason: error } : offer;
}

export function videoModelChange(_caps, provider, _video) {
  // Keep draft inputs intact. Unsupported combinations remain visible and are
  // rejected by the shared offer until the user chooses compatible values.
  return { provider: provider || undefined };
}
