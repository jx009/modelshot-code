import { describe, expect, it } from "vitest";
import { imageReferencePrompt } from "../../src/lib/studio/image-references.js";
import { jobSchema } from "../../src/lib/studio/tools.js";
import { appendResult } from "../../src/lib/studio/canvas-utils.js";
import { jobBelongsToDocument, jobDocumentFilter } from "../../src/lib/studio/job-document.js";

describe("explicit image references", () => {
  it("records roles against the actual ordered model inputs", () => {
    const base = { tool: "edit", assetId: "product", referenceAssetIds: ["style"], documentId: "canvas", documentVersion: 1, params: { prompt: "Make an ad", referenceRoles: ["subject", "style"] } };
    expect(jobSchema.safeParse(base).success).toBe(true);
    expect(jobSchema.safeParse({ ...base, params: { ...base.params, referenceRoles: ["style"] } }).success).toBe(false);
    expect(imageReferencePrompt("Make an ad", base.params.referenceRoles)).toContain("Image 2: use the visual style");
    expect(imageReferencePrompt("original prompt")).toBe("original prompt");
  });
  it("keeps video tasks in the source canvas without changing their real document identity", () => {
    const job = { id: "job", tool: "video", documentId: "child", canvasOrigin: { documentId: "canvas", layerId: "source", assetId: "image" }, resultData: { assets: [{ id: "video", contentType: "video/mp4", width: 1280, height: 720, duration: 5, posterAssetId: "poster" }] } };
    expect(jobBelongsToDocument(job, "canvas")).toBe(true);
    expect(jobBelongsToDocument(job, "child")).toBe(true);
    expect(jobBelongsToDocument(job, "unrelated")).toBe(false);
    const layers = appendResult([], job);
    expect(layers[0]).toMatchObject({ videoDocumentId: "child", assetId: "video", posterAssetId: "poster", duration: 5 });
    expect(appendResult(layers, job)).toBe(layers);
    expect(jobDocumentFilter("canvas").OR[1]).toEqual({ snapshot: { path: ["canvasOrigin", "documentId"], equals: "canvas" } });
  });
});
