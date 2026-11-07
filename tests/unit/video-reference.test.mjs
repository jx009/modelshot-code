import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { videoReferenceUrl, videoReferenceOwner } from "../../src/lib/domain/studio/video-reference.js";
import { videoMediaProof, assertVideoMedia } from "../../src/lib/domain/studio/video-media.js";

const now = Date.parse("2026-11-07T10:00:00Z");
beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY_VERSION", "1");
  vi.stubEnv("ENCRYPTION_KEY_1", "ab".repeat(32));
});
afterEach(() => vi.unstubAllEnvs());

it("binds inspected media durations to the owner and asset", () => {
  const media = { id: "asset", type: "audio", duration: 2 };
  const proof = videoMediaProof("owner", media.id, media);
  expect(() => assertVideoMedia("owner", { ...media, proof })).not.toThrow();
  expect(() => assertVideoMedia("other", { ...media, proof })).toThrow("VIDEO_MEDIA_INVALID");
  expect(() => assertVideoMedia("owner", { ...media, proof, duration: 1.9 })).toThrow("VIDEO_MEDIA_INVALID");
  expect(() => assertVideoMedia("owner", { ...media, proof, id: "different" })).toThrow("VIDEO_MEDIA_INVALID");
});

it("issues a temporary reference link bound to an owner and one asset", () => {
  const url = new URL(videoReferenceUrl("owner", "asset_1234567890", { NEXTAUTH_URL: "https://app.example" }, now));
  const token = url.searchParams.get("token");
  expect(url.pathname).toBe("/api/video/reference/asset_1234567890");
  expect(videoReferenceOwner("asset_1234567890", token, now + 1000)).toBe("owner");
  expect(() => videoReferenceOwner("different_asset", token, now)).toThrow("VIDEO_REFERENCE_EXPIRED");
  expect(() => videoReferenceOwner("asset_1234567890", token, now + 3600000)).toThrow("VIDEO_REFERENCE_EXPIRED");
});

it("rejects missing, tampered and excessively long tokens", () => {
  const token = new URL(videoReferenceUrl("owner", "asset_1234567890", { NEXTAUTH_URL: "https://app.example" }, now)).searchParams.get("token");
  for (const invalid of [null, "", `${token}corrupted`, "a".repeat(2049)]) {
    expect(() => videoReferenceOwner("asset_1234567890", invalid, now)).toThrow("VIDEO_REFERENCE_EXPIRED");
  }
});

it("requires an HTTPS application address for supplier reference fetches", () => {
  for (const NEXTAUTH_URL of [undefined, "http://localhost:3000", "https://localhost", "https://user:password@app.example"]) {
    expect(() => videoReferenceUrl("owner", "asset_1234567890", { NEXTAUTH_URL }, now)).toThrow("VIDEO_REFERENCE_URL_REQUIRED");
  }
});
