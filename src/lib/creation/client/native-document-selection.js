// Isolate the 1.2.0 exported service contract from rendering and React. Called
// only on an explicit reference action; selection events never create snapshots.
export function readNativeDocumentSelection(service, unitId) {
  const info = service.getSelectionInfo({ unitId, subUnitId: unitId });
  if (!info || info.rectRanges?.length || info.textRanges?.length !== 1) throw new Error("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
  const range = info.textRanges[0];
  return { unitId, segmentId: range.segmentId ?? info.segmentId ?? "", start: range.startOffset, end: range.endOffset };
}
