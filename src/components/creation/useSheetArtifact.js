"use client";

import { useArtifactJournal } from "./useArtifactJournal";
import { applySheetOperations, applySheetWithInverse } from "@/lib/creation/sheet-operations";

const root = id => `/api/creation/artifacts/${encodeURIComponent(id)}/sheet`;
const codec = {
  readPath: root, savePath: root, saveMethod: "PATCH", copyPath: id => `${root(id)}/copy`, restorePath: id => `${root(id)}/restore`,
  apply: applySheetOperations,
  applyWithInverse(content, operations) {
    const result = applySheetWithInverse(content, operations);
    return { document: result.workbook, inverse: result.inverse };
  },
  limitHistory: history => history.slice(-30), prepareCopy: content => content,
};
export function useSheetArtifact(userId, artifactId, draftSessionId) {
  return useArtifactJournal(userId, artifactId, draftSessionId, codec);
}
