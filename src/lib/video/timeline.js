export const VIDEO_TEMPLATES = [
  ["TikTok · 视频", "9:16"], ["YouTube · 长视频", "16:9"], ["YouTube · Shorts", "9:16"],
  ["Facebook · Stories", "9:16"], ["Instagram · Reels / Stories", "9:16"], ["Instagram · Post", "1:1"], ["Instagram · Post", "4:5"],
];
export const timelineDuration = composition => composition?.scenes.reduce((sum, scene) => sum + scene.duration, 0) || 0;
export function sceneAt(composition, time) {
  let start = 0;
  for (const [index, scene] of (composition?.scenes || []).entries()) {
    if (time < start + scene.duration || index === composition.scenes.length - 1) return { scene, index, start, local: Math.max(0, time - start) };
    start += scene.duration;
  }
  return null;
}
export function moveScene(composition, from, to) {
  if (from === to || from < 0 || to < 0 || from >= composition.scenes.length || to >= composition.scenes.length) return composition;
  const scenes = [...composition.scenes]; scenes.splice(to, 0, ...scenes.splice(from, 1));
  return { ...composition, scenes };
}
export const emptyScene = id => ({ id, name: "新场景", duration: 3, title: "输入标题", subtitle: "", background: "#111827", color: "#ffffff", accent: "#818cf8", fontSize: 64, align: "center", position: "center", animation: "rise", assetId: null, trimStart: 0, volume: 0 });
export const emptyComposition = id => ({ version: 1, ratio: "16:9", fps: 24, scenes: [emptyScene(id)], audio: null });
export const videoTime = value => `${Math.floor(value / 60).toString().padStart(2, "0")}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
