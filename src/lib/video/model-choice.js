import { videoInputError, videoModelOptions } from "./model-protocols.js";

export function videoModelOffer(caps, provider, video) {
  const base = caps?.tools?.find(tool => tool.id === "video");
  const selected = provider || caps?.videoProvider;
  if (!selected) return checkVideoOffer(base, video);
  const model = caps?.videoModels?.find(item => item.id === selected);
  if (!model) return { ...base, available: false, reason: "PROVIDER_CAPABILITY_UNSUPPORTED" };
  return checkVideoOffer({ ...base, provider: model.id, cost: model.cost, available: model.available, reason: model.available ? null : base?.reason, durations: model.durations, ratios: model.ratios, inputMode: model.inputMode, promptOptional: model.promptOptional, referenceMode: model.referenceMode, mediaLimits: model.mediaLimits, api: model.api, fields: model.fields, configuredFields: model.configuredFields }, video);
}

function checkVideoOffer(offer, video) {
  if (!video || !offer) return offer;
  const options = { ...videoModelOptions(), ...Object.fromEntries(Object.entries(offer).filter(([, value]) => value !== undefined)) };
  const error = videoInputError(options, { ...video, hasImage: video.media?.some(item => item.type === "image") });
  return error && offer.available ? { ...offer, available: false, reason: error } : offer;
}

export function videoModelChange(caps, provider, video) {
  const offer = videoModelOffer(caps, provider), defaults = videoModelOptions();
  const durations = offer?.durations || defaults.durations, ratios = offer?.ratios || defaults.ratios;
  return { provider: provider || undefined, duration: durations.includes(video.duration) ? video.duration : durations[0], ratio: ratios.includes(video.ratio) ? video.ratio : ratios[0], ...(video.videoFields ? { videoFields: {} } : {}) };
}
