// These modes describe the request that our adapters actually send. They are
// not inferred from marketing model names or from the number of uploaded files.
const FRAME_APIS = new Set(["luma", "luma-async", "luma-extend", "runway-native", "minimax", "vidu-start-end2video", "qwen-frames", "kling-image2video"]);
const FIRST_FRAME_APIS = new Set(["sora", "pixverse", "vidu-img2video", "qwen-image", "xai"]);

export function videoReferenceMode(kind, options = {}) {
  if (options.inputMode === "text") return "none";
  if (kind === "zzshu") return options.referenceMode === "first_frame" ? "frames" : "reference";
  if (kind !== "gptbest") return "first_frame";
  if (FRAME_APIS.has(options.api)) return "frames";
  if (FIRST_FRAME_APIS.has(options.api)) return "first_frame";
  return "reference";
}

export function referenceRole(media, index, all, mode) {
  if (media.role) return media.role;
  if (media.type !== "image") return `reference_${media.type}`;
  if (mode === "frames" || mode === "first_frame") return all.slice(0, index).some(item => item.type === "image") ? "last_frame" : "first_frame";
  return "reference_image";
}

export function videoReferenceError(options, media = []) {
  const mode = options.referenceLayout || (options.referenceMode === "first_frame" ? "frames" : "reference");
  if (new Set(media.map(item => item.id).filter(Boolean)).size !== media.filter(item => item.id).length) return "DUPLICATE_MEDIA";
  const roles = [];
  for (const [index, item] of media.entries()) {
    if (!["image", "video", "audio"].includes(item.type)) return "VIDEO_MEDIA_INVALID";
    const role = referenceRole(item, index, media, mode);
    const allowed = item.type !== "image" ? [`reference_${item.type}`] : mode === "frames" ? ["first_frame", "last_frame"] : mode === "first_frame" ? ["first_frame"] : ["reference_image"];
    if (mode === "none" || !allowed.includes(role)) return "VIDEO_REFERENCE_ROLE_UNSUPPORTED";
    roles.push(role);
  }
  if (["frames", "first_frame"].includes(mode)) {
    const frameRoles = roles.filter(role => ["first_frame", "last_frame"].includes(role));
    if (new Set(frameRoles).size !== frameRoles.length || frameRoles.includes("last_frame") && !frameRoles.includes("first_frame")) return "VIDEO_FRAME_ORDER_INVALID";
    // Our positional adapters and the assetId contract both use the first
    // image as the first frame. Reject conflicting explicit roles at admission.
    if (frameRoles.length && frameRoles[0] !== "first_frame") return "VIDEO_FRAME_ORDER_INVALID";
  }
  return null;
}

export function moveVideoReference(media, id, offset) {
  const index = media.findIndex(item => item.id === id), target = index + offset;
  if (index < 0 || target < 0 || target >= media.length) return media;
  const next = [...media];
  // Role belongs to the slot. Swapping first/last swaps assets, not slots.
  const frameSwap = media[index].type === "image" && media[target].type === "image" && [media[index].role, media[target].role].every(role => !role || ["first_frame", "last_frame"].includes(role));
  next[index] = frameSwap ? { ...media[target], role: media[index].role } : media[target];
  next[target] = frameSwap ? { ...media[index], role: media[target].role } : media[index];
  return next;
}

export function assignVideoReferenceRoles(media, mode) {
  return media.map((item, index) => ({ ...item, role: referenceRole({ ...item, role: undefined }, index, media, mode) }));
}

export function appendVideoReference(media, item, mode) {
  if (["frames", "first_frame"].includes(mode) && item.type === "image") {
    const first = media.some((entry, index) => referenceRole(entry, index, media, mode) === "first_frame");
    const next = { ...item, role: first ? "last_frame" : "first_frame" };
    return first ? [...media, next] : [next, ...media];
  }
  return [...media, { ...item, role: referenceRole(item, media.length, [...media, item], mode) }];
}
