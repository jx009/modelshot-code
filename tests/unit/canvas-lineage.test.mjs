import { describe, expect, it } from "vitest";
import { appendResult } from "../../src/lib/studio/canvas-utils.js";
import { canvasVideoTasks, lineageEdges, reserveCanvasTasks } from "../../src/lib/studio/canvas-lineage.js";

const source = { id: "image-layer", assetId: "image-asset", type: "image", x: 20, y: 0, width: 400, height: 300, visible: true };
const job = { id: "video-job", tool: "video", documentId: "video-doc", status: "provider_pending", canvasOrigin: { layerId: source.id, assetId: source.assetId }, inputAssetIds: [source.assetId], createdAt: "2026-11-11T00:00:00Z" };

describe("canvas generation lineage", () => {
  it("keeps the reserved result position when the source moves or a neighbor arrives", () => {
    const draft = reserveCanvasTasks({ layers: [source], appliedJobs: [] }, [job]);
    const moved = [{ ...source, x: 2000, y: 2000 }];
    const position = draft.taskPositions[job.id];
    expect(canvasVideoTasks(moved, [job], [], draft.taskPositions)[0]).toMatchObject(position);
    const complete = { ...job, status: "succeeded", resultData: { assets: [{ id: "result", contentType: "video/mp4", width: 1280, height: 720 }] } };
    expect(appendResult(moved, complete, moved[0], position)[1]).toMatchObject(position);
  });
  it("keeps provider reconciliation and cancellation visible without invented progress", () => {
    for (const status of ["queued", "provider_pending", "reconciling", "cancel_requested"]) {
      const nodes = canvasVideoTasks([source], [{ ...job, status }]);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].y).toBe(0);
      expect(nodes[0].sourceLayerIds).toEqual([source.id]);
      expect(nodes[0]).not.toHaveProperty("progress");
    }
  });
  it("retains source and provenance, deduplicates recovered results, and removes placeholders", () => {
    const complete = { ...job, status: "succeeded", resultData: { assets: [{ id: "result", width: 1280, height: 720, contentType: "video/mp4", duration: 5, posterAssetId: "poster" }] } };
    const layers = appendResult([source], complete, source);
    expect(layers[0]).toBe(source);
    expect(layers[1]).toMatchObject({ sourceLayerIds: [source.id], sourceAssetIds: [source.assetId], videoDocumentId: "video-doc", y: 0, duration: 5 });
    expect(appendResult(layers, complete, source)).toBe(layers);
    expect(canvasVideoTasks(layers, [job])).toEqual([]);
    expect(lineageEdges(layers)).toHaveLength(1);
    expect(lineageEdges(layers.slice(1))).toEqual([]);
    expect(layers[1].sourceAssetIds).toEqual([source.assetId]);
  });
  it("keeps concurrent task placeholders apart and ignores already applied jobs", () => {
    const nodes = canvasVideoTasks([source], [job, { ...job, id: "second-job" }]);
    expect(nodes).toHaveLength(2);
    expect(Math.abs(nodes[1].y - nodes[0].y)).toBeGreaterThanOrEqual(220);
    expect(canvasVideoTasks([source], [job], [job.id])).toEqual([]);
  });
});
