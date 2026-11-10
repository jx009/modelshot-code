import { describe, expect, it } from "vitest";
import { appendVideoScenes, replaceVideoScene } from "../../src/lib/video/composition-actions.js";
import { videoDocumentSchema } from "../../src/lib/video/schema.js";
import { assertMotionMedia } from "../../src/lib/domain/studio/motion.js";

const draft = () => ({ mode: "motion", ratio: "16:9", media: [] });
const clip = duration => ({ id: "clip", name: "Video", type: "video", duration, proof: "proof", width: 1920, height: 1080, posterAssetId: "cover" });

describe("generated video to editable composition", () => {
  it("replaces only the requested shot and keeps the original media for comparison", () => {
    const first = appendVideoScenes(draft(), clip(5), "one");
    const video = appendVideoScenes(first, { ...clip(8), id: "other" }, "two");
    const next = replaceVideoScene(video, { ...clip(3), id: "new" }, { sceneId: "one-0", assetId: "clip" });
    expect(next.composition.scenes[0]).toMatchObject({ assetId: "new", duration: 3, trimStart: 0 });
    expect(next.composition.scenes[1]).toBe(video.composition.scenes[1]);
    expect(next.media.map(item => item.id)).toEqual(["clip", "other", "new"]);
    expect(() => assertMotionMedia(next.composition, next.media)).not.toThrow();
    expect(() => replaceVideoScene(next, clip(5), { sceneId: "one-0", assetId: "clip" })).toThrow("MOTION_SCENE_CHANGED");
  });
  it("splits long clips without gaps or a sub-second tail and retains sound", () => {
    const value = appendVideoScenes(draft(), clip(30.5), "op");
    expect(value.composition.scenes.map(scene => [scene.trimStart, scene.duration])).toEqual([[0, 15.25], [15.25, 15.25]]);
    expect(value.composition.scenes.every(scene => scene.volume === 1 && scene.title === "")).toBe(true);
    expect(videoDocumentSchema.safeParse(value).success).toBe(true);
    expect(() => assertMotionMedia(value.composition, value.media)).not.toThrow();
    expect(value.media[0]).not.toHaveProperty("width");
  });
  it("does not duplicate scenes on a replay and shares the same media asset", () => {
    const first = appendVideoScenes(draft(), clip(5), "one");
    expect(appendVideoScenes(first, clip(5), "one")).toBe(first);
    const second = appendVideoScenes(first, clip(5), "two");
    expect(second.media).toHaveLength(1);
    expect(second.composition.scenes).toHaveLength(2);
    expect(second.composition.scenes[0]).toEqual(first.composition.scenes[0]);
  });
  it("rejects inputs that the existing bounded renderer cannot export", () => {
    expect(() => appendVideoScenes(draft(), clip(.5), "op")).toThrow("MOTION_TRIM_INVALID");
    expect(() => appendVideoScenes(draft(), { ...clip(5), bytes: 65 * 1024 * 1024 }, "op")).toThrow("VIDEO_MEDIA_TOO_LARGE");
    const full = appendVideoScenes(draft(), clip(180), "full");
    expect(() => appendVideoScenes(full, clip(1), "extra")).toThrow("VIDEO_TOO_LONG");
  });
});
