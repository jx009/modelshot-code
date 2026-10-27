import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
import { motionSchema, videoDocumentSchema } from "../../src/lib/video/schema.js";
import { emptyScene, moveScene, sceneAt, timelineDuration } from "../../src/lib/video/timeline.js";
import { assertMotionMedia, parseMotionResult } from "../../src/lib/domain/studio/motion.js";
import { jobSchema } from "../../src/lib/studio/tools.js";

const composition = () => ({ version: 1, ratio: "16:9", fps: 24, audio: null, scenes: [
  { ...emptyScene("one"), duration: 2, title: "一个想法" },
  { ...emptyScene("two"), duration: 2, title: "开始流动" },
  { ...emptyScene("three"), duration: 2, title: "即刻出发" },
] });

describe("editable video contracts", () => {
  it("seeks deterministically across scene boundaries after reordering", () => {
    const original = composition(), moved = moveScene(original, 2, 0);
    expect(original.scenes.map(scene => scene.id)).toEqual(["one", "two", "three"]);
    expect(moved.scenes.map(scene => scene.id)).toEqual(["three", "one", "two"]);
    expect(timelineDuration(moved)).toBe(6);
    expect(sceneAt(moved, 2)).toMatchObject({ index: 1, local: 0, scene: { id: "one" } });
    expect(sceneAt(moved, 6)).toMatchObject({ index: 2, local: 2 });
    expect(moveScene(original, -1, 1)).toBe(original);
  });
  it("rejects duplicated ids and unbounded compositions before dispatch", () => {
    const value = composition(); value.scenes[1].id = "one";
    expect(motionSchema.safeParse(value).success).toBe(false);
    expect(motionSchema.safeParse({ ...composition(), scenes: Array.from({ length: 7 }, (_, i) => ({ ...emptyScene(`s${i}`), duration: 30 })) }).success).toBe(false);
    expect(motionSchema.safeParse({ ...composition(), fps: 120 }).success).toBe(false);
  });
  it("requires owned media references and video generation only accepts one image", () => {
    const value = composition(); value.scenes[0].assetId = "missing";
    expect(videoDocumentSchema.safeParse({ mode: "motion", composition: value }).success).toBe(false);
    expect(videoDocumentSchema.safeParse({ mode: "video", media: [{ id: "clip", name: "clip.mp4", type: "video", duration: 5 }] }).success).toBe(false);
    expect(videoDocumentSchema.parse({ mode: "motion", composition: composition() }).confirmed).toBe(false);
  });
  it("rejects out-of-range trims and audio used as scene imagery", () => {
    const value = composition(); value.scenes[0] = { ...value.scenes[0], assetId: "clip", trimStart: 4 };
    expect(() => assertMotionMedia(value, [{ id: "clip", type: "video", duration: 5 }])).toThrow("MOTION_TRIM_INVALID");
    expect(() => assertMotionMedia(value, [{ id: "clip", type: "audio", duration: 50 }])).toThrow("MOTION_MEDIA_INVALID");
    value.scenes[0].assetId = null; value.audio = { assetId: "track", volume: .5, trimStart: 5 };
    expect(() => assertMotionMedia(value, [{ id: "track", type: "audio", duration: 5 }])).toThrow("MOTION_TRIM_INVALID");
  });
  it("accepts fenced JSON but rejects invented media and malformed model output", () => {
    expect(parseMotionResult(["```json", JSON.stringify(composition()), "```"].join(String.fromCharCode(10)))).toEqual(composition());
    expect(() => parseMotionResult("Here is your video")).toThrow("MOTION_RESULT_INVALID");
    const value = composition(); value.scenes[0].assetId = "invented";
    expect(() => parseMotionResult(JSON.stringify(value))).toThrow("MOTION_MEDIA_INVALID");
  });
  it("supports text-only generation but forbids render requests without an engineering document", () => {
    const base = { documentId: "doc", documentVersion: 1, params: { prompt: "A ball rolls" } };
    expect(jobSchema.safeParse({ ...base, tool: "video" }).success).toBe(true);
    expect(jobSchema.safeParse({ ...base, tool: "motion-render" }).success).toBe(false);
    expect(jobSchema.safeParse({ ...base, tool: "generate", params: { ...base.params, motion: composition() } }).success).toBe(false);
  });
});
