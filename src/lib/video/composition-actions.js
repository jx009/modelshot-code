import { emptyScene, timelineDuration } from "./timeline.js";

export function videoMediaInput(value) {
  return { id: value.id, name: value.name || "视频片段.mp4", type: value.type, duration: value.duration, ...(value.proof ? { proof: value.proof } : {}) };
}

export function appendVideoScenes(video, inspected, operationId) {
  if (inspected.bytes > 64 * 1024 * 1024) throw new Error("VIDEO_MEDIA_TOO_LARGE");
  const media = videoMediaInput(inspected), composition = video.composition || { version: 1, ratio: video.ratio || "16:9", fps: 24, scenes: [], audio: null };
  if (media.type !== "video" || !Number.isFinite(media.duration) || media.duration < 1 || media.duration > 180) throw new Error("MOTION_TRIM_INVALID");
  if (composition.scenes.some(scene => scene.id === `${operationId}-0`)) return video;
  const count = Math.ceil(media.duration / 30), duration = media.duration / count;
  if (composition.scenes.length + count > 40 || timelineDuration(composition) + media.duration > 180) throw new Error("VIDEO_TOO_LONG");
  if (!video.media.some(item => item.id === media.id) && video.media.length >= 40) throw new Error("VIDEO_MEDIA_LIMIT");
  const scenes = Array.from({ length: count }, (_, index) => ({ ...emptyScene(`${operationId}-${index}`), name: media.name, title: "", subtitle: "", animation: "none", assetId: media.id, duration, trimStart: duration * index, volume: 1 }));
  return { ...video, mode: "motion", confirmed: true, composition: { ...composition, scenes: [...composition.scenes, ...scenes] }, media: video.media.some(item => item.id === media.id) ? video.media : [...video.media, media] };
}

export function replaceVideoScene(video, inspected, origin) {
  const scene = video.composition?.scenes.find(item => item.id === origin.sceneId);
  if (!scene || scene.assetId !== origin.assetId) throw new Error("MOTION_SCENE_CHANGED");
  if (inspected.type !== "video" || inspected.duration < 1 || !Number.isFinite(inspected.duration)) throw new Error("MOTION_TRIM_INVALID");
  if (inspected.bytes > 64 * 1024 * 1024) throw new Error("VIDEO_MEDIA_TOO_LARGE");
  const exists = video.media.some(item => item.id === inspected.id);
  if (!exists && video.media.length >= 40) throw new Error("VIDEO_MEDIA_LIMIT");
  const duration = Math.min(scene.duration, inspected.duration), trimStart = Math.min(scene.trimStart, inspected.duration - duration);
  return { ...video, confirmed: true, media: exists ? video.media : [...video.media, videoMediaInput(inspected)],
    composition: { ...video.composition, scenes: video.composition.scenes.map(item => item.id === scene.id ? { ...item, assetId: inspected.id, duration, trimStart } : item) } };
}
