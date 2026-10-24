import { expect, it } from "vitest";
import { Univer, UniverInstanceType } from "@univerjs/core";
import { DocSelectionManagerService } from "@univerjs/docs";
import { readNativeDocumentSelection } from "../../src/lib/creation/client/native-document-selection.js";

it("reads actual 1.2.0 document selection state by owning unit, including header/footer segment identity", () => {
  const engine = new Univer(), service = engine.__getInjector().createInstance(DocSelectionManagerService);
  try {
    engine.createUnit(UniverInstanceType.UNIVER_DOC, { id: "doc", body: { dataStream: "Selected text\r\n" }, documentStyle: {} });
    const params = { unitId: "doc", subUnitId: "doc" };
    const range = { startOffset: 1, endOffset: 7, collapsed: false, isActive: true };
    service.replaceSelectionInfoWithoutRefresh({ textRanges: [range], rectRanges: [], segmentId: "header-1", segmentPage: 0, isEditing: false, style: {} }, params);
    expect(readNativeDocumentSelection(service, "doc")).toEqual({ unitId: "doc", segmentId: "header-1", start: 1, end: 7 });
    expect(() => readNativeDocumentSelection(service, "other-doc")).toThrow("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
    service.replaceSelectionInfoWithoutRefresh({ textRanges: [range, { ...range, startOffset: 8, endOffset: 10 }], rectRanges: [], segmentId: "", segmentPage: 0, isEditing: false, style: {} }, params);
    expect(() => readNativeDocumentSelection(service, "doc")).toThrow("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
    service.replaceSelectionInfoWithoutRefresh({ textRanges: [range], rectRanges: [{ ...range, tableId: "table" }], segmentId: "", segmentPage: 0, isEditing: false, style: {} }, params);
    expect(() => readNativeDocumentSelection(service, "doc")).toThrow("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
  } finally { service.dispose(); engine.dispose(); }
});
