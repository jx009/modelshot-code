import { describe, expect, it } from "vitest";
import { videoInputError, videoModelOptions } from "../../src/lib/video/model-protocols.js";
import { appendVideoReference, assignVideoReferenceRoles, moveVideoReference } from "../../src/lib/video/references.js";

const media = [{ id: "front", type: "image" }, { id: "end", type: "image" }];

it("fills an emptied first-frame slot without relabelling the retained last frame", () => {
  const last = { id: "end", type: "image", role: "last_frame" };
  const next = appendVideoReference([last], { id: "new-start", type: "image" }, "frames");
  expect(next).toEqual([{ id: "new-start", type: "image", role: "first_frame" }, last]);
});
const check = (options, references) => videoInputError(options, { duration: 5, ratio: "16:9", media: references });

describe("video reference contracts shared by canvas and workspace", () => {
  it("distinguishes real frame adapters from multi-image references", () => {
    expect(videoModelOptions("gptbest", { videoApi: "minimax" }).referenceLayout).toBe("frames");
    expect(videoModelOptions("gptbest", { videoApi: "seedance-native" }).referenceLayout).toBe("reference");
    expect(videoModelOptions("zzshu", { videoReferenceMode: "first_frame" }).referenceLayout).toBe("frames");
  });
  it("retains legacy positional frames but rejects reversed or duplicated explicit slots", () => {
    const options = videoModelOptions("gptbest", { videoApi: "minimax" });
    expect(check(options, media)).toBe(null);
    expect(check(options, [{ ...media[0], role: "last_frame" }])).toBe("VIDEO_FRAME_ORDER_INVALID");
    expect(check(options, media.map(item => ({ ...item, role: "first_frame" })))).toBe("VIDEO_FRAME_ORDER_INVALID");
    expect(check(options, [{ ...media[0], role: "last_frame" }, { ...media[1], role: "first_frame" }])).toBe("VIDEO_FRAME_ORDER_INVALID");
  });
  it("requires an explicit reinterpretation after changing incompatible modes", () => {
    const references = assignVideoReferenceRoles(media, "frames");
    const options = videoModelOptions("gptbest", { videoApi: "seedance-native" });
    expect(check(options, references)).toBe("VIDEO_REFERENCE_ROLE_UNSUPPORTED");
    expect(check(options, assignVideoReferenceRoles(references, "reference"))).toBe(null);
  });
  it("swaps assets while retaining the meaning of frame slots", () => {
    const swapped = moveVideoReference(assignVideoReferenceRoles(media, "frames"), "front", 1);
    expect(swapped.map(item => [item.id, item.role])).toEqual([["end", "first_frame"], ["front", "last_frame"]]);
  });
  it("rejects duplicate assets and image roles on audio", () => {
    const options = videoModelOptions("zzshu");
    expect(check(options, [media[0], media[0]])).toBe("DUPLICATE_MEDIA");
    expect(check(options, [{ id: "audio", type: "audio", duration: 2, role: "first_frame" }])).toBe("VIDEO_REFERENCE_ROLE_UNSUPPORTED");
  });
});
