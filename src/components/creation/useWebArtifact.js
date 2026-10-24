"use client";

import { useArtifactJournal } from "./useArtifactJournal";
import { applyWebOperations, applyWebOperationsWithInverse } from "@/lib/creation/web-operations";
import { pendingWebSourceOperations } from "@/lib/creation/client/pending-web-source";
import { assertLayoutJournalCapacity, layoutOperationBytes } from "@/lib/creation/layout-journal";

const root = id => `/api/creation/artifacts/${encodeURIComponent(id)}/web`;
const codec = {
  readPath: root, savePath: root, saveMethod: "PATCH", copyPath: id => `${root(id)}/copy`, restorePath: id => `${root(id)}/restore`, apply: applyWebOperations,
  applyWithInverse(content, operations) {
    const result = applyWebOperationsWithInverse(content, operations);
    // Do not advertise undo for a deletion whose restoring file exceeds the
    // same transport limits used by forward operations.
    try { assertLayoutJournalCapacity([], result.inverse); }
    catch { throw new Error("WEB_UNDO_BATCH_TOO_LARGE"); }
    return result;
  },
  limitHistory(history) {
    let bytes = 0;
    const retained = [];
    for (const batch of history.toReversed()) {
      bytes += batch.reduce((sum, operation) => sum + layoutOperationBytes(operation), 0);
      if (bytes > 2 * 1024 * 1024 || retained.length >= 30) break;
      retained.unshift(batch);
    }
    return retained;
  },
  prepareCopy(content, pending) {
    const operations = pendingWebSourceOperations(content, pending);
    return operations.length ? applyWebOperations(content, operations) : content;
  },
};
export function useWebArtifact(userId, artifactId, draftSessionId) {
  return useArtifactJournal(userId, artifactId, draftSessionId, codec);
}
