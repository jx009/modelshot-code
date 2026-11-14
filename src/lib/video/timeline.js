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
// 新镜头默认走“AI 首帧 + 视频”，与分镜规划的默认来源一致。
export const emptyScene = id => ({ id, name: "新镜头", duration: 5, title: "", subtitle: "", background: "#111827", color: "#ffffff", accent: "#818cf8", fontSize: 64, align: "center", position: "center", animation: "rise", assetId: null, trimStart: 0, volume: 0,
  visual: "", camera: "", source: "ai-image-video", narration: "", narrationAssetId: null, frameAssetId: null, transition: "cut", status: "draft" });
export const emptyComposition = id => ({ version: 1, ratio: "16:9", fps: 24, scenes: [emptyScene(id)], audio: null, subtitles: true, voice: null, scenario: null });
export const sceneStart = (composition, sceneId) => { let start = 0; for (const scene of composition.scenes) { if (scene.id === sceneId) return start; start += scene.duration; } return 0; };
const CAPTION_BREAK = /(?<=[。！？!?；;，,、\n])/;
// 与导出服务相同的字幕分段：按标点切分，在旁白时长内按字数比例依次显示。
export function captionAt(text, local, span) {
  const parts = text.split(CAPTION_BREAK).map(part => part.trim()).filter(Boolean);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  let start = 0;
  for (const [index, part] of parts.entries()) {
    const end = index === parts.length - 1 ? Infinity : start + span * part.length / total;
    if (local < end) return part;
    start = end;
  }
  return "";
}
export const videoTime = value => `${Math.floor(value / 60).toString().padStart(2, "0")}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
