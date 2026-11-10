import { expect, it } from "vitest";
import { compatibleVideoSource } from "../../src/lib/domain/studio/video-source.js";

const source = { tool: "video", videoKind: "gptbest", videoBaseURL: "https://provider.example/v1", videoProvider: "original", videoOptions: { api: "luma" } };
const target = { videoKind: "gptbest", videoURL: "https://provider.example/v1/", videoProvider: "extend", videoOptions: { api: "luma-extend" } };
it("only accepts compatible APIs on channels verified to share an upstream account", () => {
  expect(compatibleVideoSource(source, target)).toBe(false);
  expect(compatibleVideoSource(source, { ...target, sourceProviderNames: ["original"] })).toBe(true);
  expect(compatibleVideoSource({ ...source, videoBaseURL: "https://other.example/v1" }, { ...target, sourceProviderNames: ["original"] })).toBe(false);
  expect(compatibleVideoSource({ ...source, videoOptions: { api: "sora" } }, { ...target, sourceProviderNames: ["original"] })).toBe(false);
});
