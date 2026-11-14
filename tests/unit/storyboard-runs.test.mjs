import { beforeEach, expect, it, vi } from "vitest";

const configs = vi.hoisted(() => ({ video: { videoProvider: "video-a", videoOptions: { inputMode: "both", durations: [5, 10], ratios: ["16:9", "9:16"] } } }));
vi.mock("../../src/lib/domain/studio/providers.js", () => ({
  studioConfig: vi.fn(async (_db, name, capability) => capability === "video" ? configs.video : capability === "voice" ? { voiceChannel: { name: name || "voice-a", voiceOptions: { voices: [{ id: "alloy", label: "女声" }] } } } : { imageProvider: name || "image-a" }),
  capabilities: vi.fn(async () => ({ tools: [
    { id: "generate", available: true, cost: 6 }, { id: "video", available: true, cost: 60 }, { id: "tts", available: true, cost: 2 }, { id: "motion-render", available: true, cost: 0 },
  ] })),
}));
vi.mock("../../src/lib/domain/studio/documents.js", () => ({ saveDocument: vi.fn(async (_userId, input) => ({ ...input, version: input.version + 1 })) }));

const { planStoryboard, applyStoryboardResults } = await import("../../src/lib/domain/creation/storyboard-runs.js");
const { saveDocument } = await import("../../src/lib/domain/studio/documents.js");
const { parseMotionResult } = await import("../../src/lib/domain/studio/motion.js");

const scene = (id, values = {}) => ({ id, name: `镜头${id}`, duration: 5, title: "", subtitle: "", background: "#111827", color: "#ffffff", accent: "#818cf8", fontSize: 64, align: "center", position: "center", animation: "rise", assetId: null, trimStart: 0, volume: 0,
  visual: `画面 ${id}`, camera: "缓慢推近", source: "ai-image-video", narration: "", narrationAssetId: null, frameAssetId: null, transition: "cut", status: "draft", ...values });
const video = (scenes, values = {}) => ({ mode: "motion", media: [], ratio: "16:9", confirmed: false, composition: { version: 1, ratio: "16:9", fps: 24, scenes, audio: null, subtitles: true, voice: null, scenario: null, ...values } });

beforeEach(() => { configs.video = { videoProvider: "video-a", videoOptions: { inputMode: "both", durations: [5, 10], ratios: ["16:9", "9:16"] } }; vi.mocked(saveDocument).mockClear(); });

it("plans first frame → video per shot, narration, and a final render that depends on everything", async () => {
  const plan = await planStoryboard(video([scene("a", { narration: "欢迎" }), scene("b", { source: "ai-image", duration: 3 }), scene("c", { source: "text", visual: "" })], { voice: { provider: "voice-a", voice: "alloy" } }), ["a", "b", "c"], {});
  expect(plan.steps.map(step => step.tool)).toEqual(["generate", "video", "tts", "generate", "motion-render"]);
  const [frame, clip, voice, , render] = plan.steps;
  expect(clip.dependsOn).toEqual([frame.id]);
  expect(voice.dependsOn).toEqual([]);
  expect(render.dependsOn).toEqual(plan.steps.slice(0, -1).map(step => step.id));
  expect(plan.steps.map(step => step.status)).toEqual(["ready", "blocked", "blocked", "blocked", "blocked"]);
  expect(frame.params).toMatchObject({ sceneId: "a", provider: "image-a", params: { size: "1536x1024" } });
  expect(clip.params).toMatchObject({ sceneId: "a", provider: "video-a", params: { ratio: "16:9", duration: 5 } });
  expect(clip.params.params.prompt).toContain("镜头运动：缓慢推近");
  expect(voice.params).toMatchObject({ provider: "voice-a", params: { prompt: "欢迎", voice: "alloy" } });
  expect(plan.total).toBe(6 + 60 + 2 + 6 + 0);
  expect(plan.lines).toHaveLength(5);
});

it("skips the first frame for text-only video models and snaps durations to the model", async () => {
  configs.video = { videoProvider: "video-t", videoOptions: { inputMode: "text", durations: [8], ratios: ["16:9"] } };
  const plan = await planStoryboard(video([scene("a", { duration: 4 })]), ["a"], {});
  expect(plan.steps.map(step => step.tool)).toEqual(["video", "motion-render"]);
  expect(plan.steps[0].params.params.duration).toBe(8);
});

it("rejects unknown shots, empty AI shots and voices the admin did not configure", async () => {
  await expect(planStoryboard(video([scene("a")]), ["missing"], {})).rejects.toMatchObject({ code: "MOTION_SCENE_CHANGED" });
  await expect(planStoryboard(video([scene("a", { visual: "" })]), ["a"], {})).rejects.toMatchObject({ code: "STORYBOARD_SHOT_EMPTY" });
  await expect(planStoryboard(video([scene("a", { narration: "你好" })], { voice: { provider: "voice-a", voice: "nova" } }), ["a"], {})).rejects.toMatchObject({ code: "VOICE_UNSUPPORTED" });
});

it("writes generated frames, clips and narration back into the storyboard before rendering", async () => {
  const content = { schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [], video: video([scene("a", { narration: "欢迎" }), scene("b", { source: "ai-image", duration: 2 })]) };
  const run = { id: "run-1", userId: "u1", documentId: "doc", steps: [
    { id: "f", tool: "generate", jobId: "j-f", params: { sceneId: "a" } }, { id: "v", tool: "video", jobId: "j-v", params: { sceneId: "a" } },
    { id: "t", tool: "tts", jobId: "j-t", params: { sceneId: "a" } }, { id: "g", tool: "generate", jobId: "j-g", params: { sceneId: "b" } },
    { id: "r", tool: "motion-render", jobId: null, params: { role: "render" } },
  ] };
  const jobs = { "j-f": "j-f_studio_0", "j-v": "j-v_studio_video", "j-t": "j-t_studio_voice", "j-g": "j-g_studio_0" };
  const db = {
    studioDocument: { findFirst: async () => ({ id: "doc", version: 3, name: "工程", content }) },
    tryOn: { findMany: async () => Object.entries(jobs).map(([id, asset]) => ({ id, resultData: { assets: [{ id: asset, ...(id === "j-t" ? { duration: 3.2, proof: "voice-proof" } : {}) }] } })) },
  };
  const inspect = vi.fn(async (_userId, assetId) => ({ id: assetId, type: "video", duration: 4.04, proof: "video-proof" }));
  await applyStoryboardResults(run, { db, inspect });
  const saved = vi.mocked(saveDocument).mock.calls[0][1];
  expect(saved).toMatchObject({ id: "doc", version: 3 });
  const [a, b] = saved.content.video.composition.scenes;
  expect(a).toMatchObject({ assetId: "j-v_studio_video", frameAssetId: "j-f_studio_0", narrationAssetId: "j-t_studio_voice", duration: 4, status: "ready" });
  // 静态画面镜头不改变；图片镜头使用首帧作为画面
  expect(b).toMatchObject({ assetId: "j-g_studio_0", frameAssetId: "j-g_studio_0", duration: 2, status: "ready" });
  expect(saved.content.video).toMatchObject({ confirmed: true, shotRunId: "run-1" });
  expect(saved.content.video.media.map(item => item.id).sort()).toEqual(Object.values(jobs).sort());
  expect(saved.content.video.media.find(item => item.type === "audio")).toMatchObject({ duration: 3.2, proof: "voice-proof" });
  // 已写回的运行不会重复写入
  vi.mocked(saveDocument).mockClear();
  await applyStoryboardResults(run, { db: { ...db, studioDocument: { findFirst: async () => ({ id: "doc", version: 4, content: { ...content, video: { ...saved.content.video } } }) } }, inspect });
  expect(saveDocument).not.toHaveBeenCalled();
});

it("keeps generated assets when a revised plan leaves a shot unchanged and drops unknown model fields", () => {
  const previous = { version: 1, ratio: "16:9", fps: 24, audio: null, subtitles: false, voice: { provider: "voice-a", voice: "alloy" }, scenario: "product",
    scenes: [scene("a", { assetId: "clip_studio_video", frameAssetId: "frame_studio_0", narration: "欢迎", narrationAssetId: "voice_studio_voice", status: "ready" }), scene("b")] };
  const media = [{ id: "clip_studio_video", type: "video", duration: 5 }, { id: "frame_studio_0", type: "image", duration: 0 }, { id: "voice_studio_voice", type: "audio", duration: 2 }];
  const text = JSON.stringify({ version: 1, ratio: "16:9", fps: 24, audio: null, scenes: [
    { ...scene("a", { narration: "欢迎光临" }), assetId: null, frameAssetId: undefined, narrationAssetId: undefined, status: "hacked", bogus: 1 },
    { ...scene("b", { visual: "新的画面" }), assetId: null },
  ] });
  const parsed = parseMotionResult(text, media, previous);
  expect(parsed.scenes[0]).toMatchObject({ assetId: "clip_studio_video", frameAssetId: "frame_studio_0", narrationAssetId: null, status: "ready" });
  expect(parsed.scenes[1]).toMatchObject({ assetId: null, frameAssetId: null, status: "draft", visual: "新的画面" });
  expect(parsed).toMatchObject({ subtitles: false, voice: { provider: "voice-a", voice: "alloy" }, scenario: "product" });
});
