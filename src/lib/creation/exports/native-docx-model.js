import { nativeOfficeArtifactSchema } from "../contracts/native-office.js";
import { safeNativeOfficeLink } from "../native-office-media.js";

export const docxFail = (code = "EXPORT_NATIVE_DOCUMENT_UNSUPPORTED") => { throw new Error(code); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const populated = value => value != null && (typeof value !== "object" || Object.keys(value).length > 0);
export function docxKeys(value, allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key) && populated(value[key]))) docxFail();
}
export function docxNumber(value, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) docxFail("EXPORT_NATIVE_DOCUMENT_INVALID");
  return value;
}
const boundary = (text, offset) => Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length
  && !(offset > 0 && offset < text.length && /[\ud800-\udbff]/.test(text[offset - 1]) && /[\udc00-\udfff]/.test(text[offset]));
const invalid = () => docxFail("EXPORT_NATIVE_DOCUMENT_INVALID");

// A checked view over the source, not a schema-1 projection. UTF-16 offsets,
// original paragraph metadata, styles and nested table structures remain
// intact. One stream walk and indexed metadata avoid repeated whole-body scans.
function parseBody(body, budget) {
  docxKeys(body, ["dataStream", "textRuns", "paragraphs", "sectionBreaks", "tables", "customBlocks", "customRanges", "renderedPageBreaks"]);
  const text = body.dataStream;
  if (typeof text !== "string" || !text.isWellFormed() || !text.endsWith("\r\n")) invalid();
  budget.characters += text.length;
  if (budget.characters > 500000) docxFail("EXPORT_NATIVE_DOCUMENT_LIMIT");
  const indexed = (name, token) => {
    const values = body[name] ?? []; if (!Array.isArray(values)) invalid();
    const map = new Map(); let last = -1;
    for (const item of values) {
      if (!record(item) || !boundary(text, item.startIndex) || item.startIndex <= last || text[item.startIndex] !== token) invalid();
      last = item.startIndex; map.set(item.startIndex, item);
    }
    return map;
  };
  const paragraphs = indexed("paragraphs", "\r"), sections = indexed("sectionBreaks", "\n"), tables = indexed("tables", "\x1a"), blocks = indexed("customBlocks", "\b"), ranges = indexed("customRanges", "\x1f");
  for (const value of tables.values()) {
    docxKeys(value, ["tableId", "startIndex", "endIndex"]);
    if (!boundary(text, value.endIndex) || value.endIndex <= value.startIndex || text[value.endIndex - 1] !== "\x0f") invalid();
  }
  for (const value of ranges.values()) {
    docxKeys(value, ["startIndex", "endIndex", "rangeId", "rangeType", "wholeEntity", "properties"]);
    if (!boundary(text, value.endIndex) || value.endIndex <= value.startIndex || text[value.endIndex] !== "\x1e") invalid();
    if (value.wholeEntity) docxFail();
    if (value.rangeType === 0) {
      docxKeys(value.properties, ["url", "textStyleMode", "textColorMode"]);
      if (!safeNativeOfficeLink(value.properties.url) || value.properties.textStyleMode != null && !["text", "link"].includes(value.properties.textStyleMode)
        || value.properties.textColorMode != null && !["text", "link"].includes(value.properties.textColorMode)) docxFail();
    }
    else if (value.rangeType === 1) {
      docxKeys(value.properties, ["instruction", "fieldType", "cachedResult", "sourceKind", "dirty", "locked"]);
      if (!["PAGE", "NUMPAGES"].includes(value.properties.fieldType) || typeof value.properties.instruction !== "string" || value.properties.instruction.trim() !== value.properties.fieldType || value.properties.locked) docxFail();
    } else docxFail();
  }
  const soft = new Set(body.renderedPageBreaks ?? []);
  if (!Array.isArray(body.renderedPageBreaks ?? [])) invalid();
  for (const position of soft) if (!boundary(text, position) || text[position] !== "\f") invalid();
  const runs = body.textRuns ?? []; if (!Array.isArray(runs)) invalid(); let last = 0;
  for (const run of runs) {
    docxKeys(run, ["st", "ed", "sId", "ts"]);
    if (!boundary(text, run.st) || !boundary(text, run.ed) || run.st < last || run.ed <= run.st) invalid(); last = run.ed;
  }
  let offset = 0, runIndex = 0;
  const take = (map, position) => { const value = map.get(position); if (!value) invalid(); map.delete(position); return value; };
  const format = () => {
    while (runs[runIndex] && runs[runIndex].ed <= offset) runIndex++;
    const run = runs[runIndex]; return run && run.st <= offset ? { ts: run.ts, sId: run.sId } : {};
  };
  function inline(endToken = "\r", rangeDepth = 0) {
    if (rangeDepth > 8) docxFail("EXPORT_NATIVE_DOCUMENT_LIMIT");
    const result = [];
    while (offset < text.length && text[offset] !== endToken) {
      const at = offset, style = format(), ch = text[offset];
      if (++budget.inline > 100000) docxFail("EXPORT_NATIVE_DOCUMENT_LIMIT");
      if (ch === "\x1f") {
        const range = take(ranges, offset++), children = inline("\x1e", rangeDepth + 1);
        if (offset !== range.endIndex || text[offset++] !== "\x1e") invalid();
        result.push({ type: range.rangeType === 0 ? "link" : "field", range, children });
      } else if (ch === "\b") {
        const block = take(blocks, offset++); docxKeys(block, ["startIndex", "blockId", "blockType"]);
        if (block.blockType != null && block.blockType !== 0) docxFail();
        result.push({ type: "image", blockId: block.blockId, ...style });
      } else if (["\t", "\f", "\v"].includes(ch)) {
        result.push({ type: ch === "\t" ? "tab" : ch === "\v" ? "columnBreak" : soft.has(at) ? "softPageBreak" : "pageBreak", ...style }); offset++;
      } else {
        if (ch.charCodeAt(0) < 32 || /[\ufffe\uffff]/.test(ch)) invalid();
        const nextRun = runs[runIndex], boundaryEnd = nextRun ? nextRun.st > offset ? nextRun.st : nextRun.ed : text.length;
        do { offset++; } while (offset < boundaryEnd && text.charCodeAt(offset) >= 32 && !/[\ufffe\uffff]/.test(text[offset]));
        result.push({ type: "text", text: text.slice(at, offset), ...style });
      }
    }
    if (offset >= text.length) invalid();
    return result;
  }
  function sequence(stop, depth = 0) {
    if (depth > 8) docxFail("EXPORT_NATIVE_DOCUMENT_LIMIT");
    const result = [];
    while (offset < text.length && text[offset] !== stop) {
      if (text[offset] === "\x1a") {
        const meta = take(tables, offset++), rows = [];
        while (text[offset] === "\x1b") {
          offset++; const cells = [];
          while (text[offset] === "\x1c") {
            offset++; if (++budget.cells > 10000) docxFail("EXPORT_NATIVE_DOCUMENT_LIMIT");
            cells.push(sequence("\x1d", depth + 1)); if (text[offset++] !== "\x1d") invalid();
          }
          if (!cells.length || text[offset++] !== "\x0e") invalid(); rows.push(cells);
        }
        if (!rows.length || text[offset++] !== "\x0f" || offset !== meta.endIndex) invalid();
        result.push({ type: "table", tableId: meta.tableId, rows });
      } else if (text[offset] === "\n") {
        result.push({ type: "section", meta: take(sections, offset++) });
      } else {
        const children = inline(), meta = take(paragraphs, offset), markStyle = format(); offset++;
        if (++budget.paragraphs > 20000) docxFail("EXPORT_NATIVE_DOCUMENT_LIMIT");
        result.push({ type: "paragraph", meta, children, markStyle });
      }
    }
    return result;
  }
  const nodes = sequence(null);
  if (offset !== text.length || [paragraphs, sections, tables, blocks, ranges].some(map => map.size)) invalid();
  return nodes;
}

export function parseNativeDocumentForDocx(input) {
  const parsed = nativeOfficeArtifactSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== "document") invalid();
  const content = parsed.data, snapshot = content.snapshot;
  docxKeys(snapshot, ["id", "title", "rev", "locale", "body", "documentStyle", "styles", "settings", "resources", "disabled", "tableSource", "headers", "footers", "lists", "drawings", "drawingsOrder", "headerFooterDrawingsOrder", "custom"]);
  if (snapshot.disabled) docxFail();
  if (snapshot.custom != null) { docxKeys(snapshot.custom, ["modelshot"]); if (snapshot.custom.modelshot != null) docxKeys(snapshot.custom.modelshot, ["adapterVersion", "sections", "mappings"]); }
  if (snapshot.settings != null) docxKeys(snapshot.settings, ["zoomRatio"]);
  for (const resource of snapshot.resources ?? []) {
    if (resource.name === "DOC_OBJECT_PERMISSION_PLUGIN" && resource.data?.trim() === "[]") continue;
    if (!["DOC_WORD_STYLES_PLUGIN", "DOC_NOTE_PLUGIN"].includes(resource.name) || resource.data && resource.data !== "{}") docxFail();
  }
  const budget = { characters: 0, paragraphs: 0, cells: 0, inline: 0 }, stories = new Map();
  stories.set("", { nodes: parseBody(snapshot.body, budget), kind: "main" });
  for (const [field, kind] of [["headers", "header"], ["footers", "footer"]]) {
    if (snapshot[field] == null) continue; if (!record(snapshot[field])) invalid();
    for (const [id, value] of Object.entries(snapshot[field])) {
      docxKeys(value, [`${kind}Id`, "body"]);
      if (value[`${kind}Id`] !== id || stories.has(id)) invalid();
      if (stories.size >= 33) docxFail("EXPORT_NATIVE_DOCUMENT_LIMIT");
      stories.set(id, { nodes: parseBody(value.body, budget), kind });
    }
  }
  return { content, snapshot, stories };
}
