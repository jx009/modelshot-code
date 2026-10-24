import { inspectNativeOfficeJson, nativeOfficeArtifactSchema } from "../contracts/native-office.js";
import { nativeDocumentAssetId, safeNativeOfficeLink } from "../native-office-media.js";

const documentResources = new Set(["DOC_WORD_STYLES_PLUGIN", "DOC_NOTE_PLUGIN"]);
const sheetResources = new Set(["SHEET_RANGE_THEME_MODEL_PLUGIN", "SHEET_WORKSHEET_PROTECTION_PLUGIN", "SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN", "SHEET_RANGE_PROTECTION_PLUGIN", "SHEET_DEFINED_NAME_PLUGIN"]);
const nonempty = value => value && typeof value === "object" && Object.keys(value).length > 0;
const fail = code => { throw new Error(code); };

// This is an intentionally bounded first runtime profile, not an Office import
// sanitizer. Unsupported files remain stored intact; never strip plugin data
// to make a file appear editable. Conversion/import needs its own validation.
export function assertNativeOfficeRuntimeContent(input) {
  const content = nativeOfficeArtifactSchema.parse(input), data = content.snapshot;
  for (const resource of data.resources || []) {
    // The pinned docs preset always saves this empty array. Nonempty rules
    // need permission enforcement and must not be silently discarded.
    if (content.kind === "document" && resource.name === "DOC_OBJECT_PERMISSION_PLUGIN" && resource.data?.trim() === "[]") continue;
    if (content.kind === "sheet" && resource.name === "SHEET_AuthzIoMockService_PLUGIN" && resource.data?.trim() === "{}") continue;
    if (content.kind === "document" && documentResources.has(resource.name)) continue; // These two plugins round-trip opaque strings.
    if (content.kind !== "sheet" || !sheetResources.has(resource.name)) fail("NATIVE_OFFICE_RESOURCE_UNSUPPORTED");
    if (resource.data) {
      let parsed;
      try { parsed = JSON.parse(resource.data); } catch { fail("NATIVE_OFFICE_RESOURCE_UNSUPPORTED"); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || inspectNativeOfficeJson(parsed)) fail("NATIVE_OFFICE_RESOURCE_UNSUPPORTED");
      // Named formulas require a separate formula/reference validator.
      if (resource.name === "SHEET_DEFINED_NAME_PLUGIN" && nonempty(parsed)) fail("NATIVE_OFFICE_RESOURCE_UNSUPPORTED");
    }
  }
  const pending = [data], imageSources = new WeakSet(), links = new WeakSet(), mediaIds = new Set();
  let drawings = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, value] of Object.entries(item)) {
      if (key === "resources" || key === "custom") continue;
      if (key === "drawings" && nonempty(value)) {
        if (content.kind !== "document" || Array.isArray(value)) fail("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
        for (const [drawingId, drawing] of Object.entries(value)) {
          const assetId = nativeDocumentAssetId(drawing?.source), size = drawing?.docTransform?.size;
          if (!drawing || drawing.drawingId !== drawingId || drawing.drawingType !== 0 || drawing.imageSourceType !== "URL" || !assetId || !content.assetIds.includes(assetId)
            || !size || ![size.width, size.height].every(n => Number.isFinite(n) && n > 0 && n <= 1600)) fail("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
          imageSources.add(drawing); mediaIds.add(assetId);
          if (++drawings > 100 || mediaIds.size > 16) fail("NATIVE_OFFICE_RUNTIME_LIMIT");
        }
      }
      if (key === "customRanges" && nonempty(value)) {
        if (content.kind !== "document" || !Array.isArray(value) || typeof item.dataStream !== "string") fail("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
        for (const range of value) {
          if (!Number.isSafeInteger(range.startIndex) || !Number.isSafeInteger(range.endIndex) || range.startIndex < 0 || range.endIndex <= range.startIndex
            || item.dataStream[range.startIndex] !== "\x1f" || item.dataStream[range.endIndex] !== "\x1e") fail("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
          if (range.rangeType === 0 && safeNativeOfficeLink(range.properties?.url)) links.add(range.properties);
          else if (range.rangeType !== 1 || !["PAGE", "NUMPAGES"].includes(range.properties?.fieldType) || range.properties.instruction !== range.properties.fieldType) fail("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
        }
      }
      if (["src", "source", "url", "link"].includes(key) && typeof value === "string" && value
        && !(key === "source" && imageSources.has(item)) && !(key === "url" && links.has(item))) fail("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
      if (value && typeof value === "object") pending.push(value);
    }
  }
  if (content.kind === "sheet") {
    let formulas = 0;
    for (const sheet of Object.values(data.sheets)) {
      if (sheet.rowCount > 100000 || sheet.columnCount > 1024 || (sheet.mergeData?.length || 0) > 10000) fail("NATIVE_OFFICE_RUNTIME_LIMIT");
      for (const row of Object.values(sheet.cellData)) for (const cell of Object.values(row)) {
        if (!cell?.f) continue;
        if (++formulas > 10000 || typeof cell.f !== "string" || cell.f.length > 2000) fail("NATIVE_OFFICE_RUNTIME_LIMIT");
        if (/\[|(?:https?|file|javascript):|\b(?:WEBSERVICE|IMAGE|HYPERLINK|IMPORTXML|IMPORTDATA|IMPORTRANGE)\s*\(/i.test(cell.f)) fail("NATIVE_OFFICE_FORMULA_UNSUPPORTED");
      }
    }
  }
  return content;
}
