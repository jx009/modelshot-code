"use client";

import { useArtifactJournal } from "./useArtifactJournal";
import { applyDocumentOperations, applyDocumentWithInverse } from "@/lib/creation/document-operations";

const root = id => `/api/creation/artifacts/${encodeURIComponent(id)}/document`;
const codec = {
  readPath: root, savePath: root, saveMethod: "PATCH", copyPath: id => `${root(id)}/copy`, restorePath: id => `${root(id)}/restore`,
  apply: applyDocumentOperations, applyWithInverse: applyDocumentWithInverse, limitHistory: history => history.slice(-30),
  prepareCopy: content => content,
};
export function useDocumentArtifact(userId, artifactId, draftSessionId) {
  return useArtifactJournal(userId, artifactId, draftSessionId, codec);
}
