import { describe, expect, it } from "vitest";
import { auditData, auditMedia, auditSummary } from "../../src/lib/domain/identity/generation-audit.js";

describe("generation audit serialization", () => {
  it("keeps full prompts for failed jobs, original creative parameters, and the actual OCR model", () => {
    const prompt = "用户的完整输入".repeat(100);
    const summary = auditSummary({ id: "failed-job", prompt, status: "failed", errorCode: "INVALID_IMAGE_SIZE", User: { email: "creator@example.com" },
      snapshot: { kind: "studio", tool: "ocr", imageModel: "dedicated-ocr", chatModel: "general-planner" } });
    expect(summary).toMatchObject({ prompt, userPrompt: prompt, status: "failed", errorCode: "INVALID_IMAGE_SIZE", model: "dedicated-ocr" });
    expect(auditData({ prompt, apiKey: "private", nested: { secretAccessKey: "private", authorization: "private", passwordHash: "private", providerBaseURL: "private", scale: 4 }, when: new Date(0) }))
      .toEqual({ prompt, nested: { scale: 4 }, when: "1970-01-01T00:00:00.000Z" });
  });

  it("uses admin asset access for all references, masks, outputs and video, with no duplicates", () => {
    const media = auditMedia({ clothesImage: "/api/assets/source", originalAssetId: "video", resultImage: "/api/assets/out",
      snapshot: { assetId: "source", maskId: "mask", referenceAssetIds: ["ref", "source"], moveBundle: { objectAssetId: "object", holeAssetId: "hole" } },
      resultData: { assets: [{ id: "out", contentType: "image/png" }, { id: "video", contentType: "video/mp4" }] },
      auditReferences: [{ assetId: "extra", kind: "generation_input" }, { assetId: "out", kind: "generation_output" }] });
    expect(media.inputs.map(item => item.id)).toEqual(["source", "mask", "ref", "object", "hole", "extra"]);
    expect(media.outputs.map(item => item.id)).toEqual(["video", "out"]);
    expect(media.outputs[0].contentType).toBe("video/mp4");
    expect([...media.inputs, ...media.outputs].every(item => item.url === `/api/admin/assets/${item.id}`)).toBe(true);
    expect(auditMedia({ resultImage: "javascript:alert(1)", personImage: "//evil.test/a" })).toEqual({ inputs: [], outputs: [] });
  });
});
