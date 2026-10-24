"use client";

import { useArtifactJournal } from "./useArtifactJournal";
import { applyArtworkOperations as applyLayoutOperations, applyArtworkWithInverse as applyWithInverse } from "@/lib/creation/artwork-codec";
import { pendingTextOperations } from "@/lib/creation/client/pending-text";
import { layoutOperationBytes } from "@/lib/creation/layout-journal";

const root = id => `/api/creation/artifacts/${encodeURIComponent(id)}`;
const codec = {
  readPath: root, savePath: id => `${root(id)}/operations`, saveMethod: "POST", copyPath: id => `${root(id)}/copy`,
  apply: applyLayoutOperations, applyWithInverse, limitHistory: history => {
    let bytes = 0; const result = [];
    for (const entry of history.slice(-30).reverse()) { bytes += entry.reduce((sum, op) => sum + layoutOperationBytes(op), 0); if (bytes > 4 * 1024 * 1024) break; result.unshift(entry); }
    return result;
  },
  prepareCopy: (content, pending) => !pending ? content : applyLayoutOperations(content, pendingTextOperations(content, pending)),
};
export function useLayoutArtifact(userId, artifactId, draftSessionId) {
  return useArtifactJournal(userId, artifactId, draftSessionId, codec);
}
