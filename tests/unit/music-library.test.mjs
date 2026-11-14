import { expect, it } from "vitest";
import { assertLibraryAudio, presentTrack } from "../../src/lib/domain/studio/music-library.js";
import { assertMotionMedia } from "../../src/lib/domain/studio/motion.js";
import { motionAssetIds, motionLibraryAssetId, videoDocumentSchema } from "../../src/lib/video/schema.js";

const asset = { id: "track_asset", status: "active", deletedAt: null, contentType: "audio/mpeg", bytes: 10 };
const track = { id: "track_1", assetId: "track_asset", name: "轻快清晨", mood: "欢快", duration: 60, isActive: true, deletedAt: null, sortOrder: 1, asset };
const db = rows => ({ musicTrack: { findFirst: async ({ where }) => rows.find(row => row.id === where.id && row.deletedAt === where.deletedAt && row.isActive === where.isActive) || null } });
const scene = (values = {}) => ({ id: "s1", name: "开场", duration: 5, title: "", ...values });
const composition = audio => ({ version: 1, ratio: "16:9", fps: 24, scenes: [scene()], audio });

it("resolves only active library tracks whose asset matches the composition", async () => {
  await expect(assertLibraryAudio(composition({ assetId: "track_asset", volume: .5, trimStart: 0, libraryTrackId: "track_1" }), db([track]))).resolves.toBe(track);
  await expect(assertLibraryAudio(composition({ assetId: "someone_else", volume: .5, trimStart: 0, libraryTrackId: "track_1" }), db([track]))).rejects.toMatchObject({ code: "MUSIC_TRACK_CHANGED" });
  await expect(assertLibraryAudio(composition({ assetId: "track_asset", volume: .5, trimStart: 0, libraryTrackId: "track_1" }), db([{ ...track, isActive: false }]))).rejects.toMatchObject({ code: "MUSIC_TRACK_NOT_FOUND" });
  await expect(assertLibraryAudio(composition({ assetId: "track_asset", volume: .5, trimStart: 61, libraryTrackId: "track_1" }), db([track]))).rejects.toMatchObject({ code: "MOTION_TRIM_INVALID" });
  await expect(assertLibraryAudio(composition(null), db([]))).resolves.toBeNull();
});

it("keeps library music out of user media while still requiring narration audio in media", () => {
  const value = { ...composition({ assetId: "track_asset", volume: .5, trimStart: 0, libraryTrackId: "track_1" }), scenes: [scene({ narration: "欢迎", narrationAssetId: "voice_1" })] };
  expect(motionAssetIds(value)).toEqual(["voice_1"]);
  expect(motionLibraryAssetId(value)).toBe("track_asset");
  expect(() => assertMotionMedia(value, [{ id: "voice_1", type: "audio", duration: 2 }])).not.toThrow();
  expect(() => assertMotionMedia(value, [{ id: "voice_1", type: "image", duration: 0 }])).toThrow();
  expect(() => assertMotionMedia(value, [])).toThrow();
});

it("parses older motion projects without storyboard fields", () => {
  const parsed = videoDocumentSchema.parse({ mode: "motion", composition: { version: 1, ratio: "9:16", fps: 24, scenes: [{ id: "a", name: "旧镜头", duration: 3, title: "标题" }], audio: null } });
  expect(parsed.composition.scenes[0]).toMatchObject({ source: "text", visual: "", narration: "", transition: "cut", narrationAssetId: null });
  expect(parsed.composition).toMatchObject({ subtitles: true, voice: null, scenario: null });
});

it("exposes a preview url but no storage details to users", () => {
  expect(presentTrack(track)).toEqual({ id: "track_1", name: "轻快清晨", mood: "欢快", duration: 60, assetId: "track_asset", previewUrl: "/api/video/music/track_1/audio" });
});
