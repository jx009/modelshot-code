import { expect, it } from "vitest";
import { videoModelOffer } from "../../src/lib/video/model-choice.js";
import { videoModelOptions, videoInputError } from "../../src/lib/video/model-protocols.js";
import { publicVideoOptions } from "../../src/lib/video/gptbest-catalog.js";
import { selectVideoVariant, videoVariantsSchema } from "../../src/lib/video/variants.js";

const config = { videoApi: "unified-seedance", videoVariants: [{ id: "silent-hd", label: "HD", resolution: "720p", audio: false, creditCost: 42, durations: [5], ratios: ["16:9"], parameters: { resolution: "720p", generate_audio: false } }] };

it("quotes the same explicit combination and rejects incompatible duration before admission", () => {
  const options = videoModelOptions("gptbest", config), visible = publicVideoOptions(options);
  const caps = { videoProvider: "channel", videoModels: [{ id: "channel", available: true, cost: 10, ...visible }], tools: [{ id: "video", available: true, cost: 10 }] };
  const video = { videoVariant: "silent-hd", duration: 5, ratio: "16:9", media: [] };
  expect(videoModelOffer(caps, "channel", video)).toMatchObject({ available: true, cost: 42, durations: [5] });
  expect(videoInputError(options, { ...video, duration: 10 })).toBe("VIDEO_DURATION_UNSUPPORTED");
  expect(videoInputError(options, { ...video, videoVariant: undefined })).toBe("VIDEO_VARIANT_REQUIRED");
  expect(visible.variants[0]).not.toHaveProperty("parameters");
  expect(selectVideoVariant(options, "silent-hd").options.parameters).toEqual({ resolution: "720p", generate_audio: false });
});

it("does not allow secret-bearing presets or unsupported duration values", () => {
  expect(videoVariantsSchema.safeParse([{ ...config.videoVariants[0], parameters: { apiKey: "secret" } }]).success).toBe(false);
  expect(videoVariantsSchema.safeParse([{ ...config.videoVariants[0], durations: [18] }]).success).toBe(false);
});
