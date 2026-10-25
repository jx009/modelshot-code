import { officeEqual as same, officeImportMetadata } from "./identity.js";

function fail(code) { const error = new Error(code); error.code = code; throw error; }
// Small save-time guard: no ZIP, XML, editor engine, or conversion in Next.
export function importedParagraphs(snapshot, segment = "") {
  const body = segment ? snapshot.headers?.[segment]?.body || snapshot.footers?.[segment]?.body : snapshot.body;
  if (!body) fail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
  const result = new Map(), spans = []; let previous = 0;
  for (const p of body.paragraphs || []) {
    if (!p.paragraphId || result.has(p.paragraphId) || p.startIndex < previous || body.dataStream[p.startIndex] !== "\r") fail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
    while (previous < p.startIndex && /[\n\x1a\x1b\x1c\x1d\x0e\x0f]/.test(body.dataStream[previous])) previous++;
    const start = previous, end = p.startIndex;
    const value = { text: body.dataStream.slice(start, end), style: p.paragraphStyle || {}, bullet: p.bullet || null, runs: [], ranges: [] };
    result.set(p.paragraphId, value); spans.push({ start, end, value });
    previous = end + 1;
  }
  // Index paragraph intervals once. Filtering every run/range for every
  // paragraph made long imported documents quadratic on each autosave.
  const firstEndingAfter = offset => {
    let lo = 0, hi = spans.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid].end <= offset) lo = mid + 1; else hi = mid; }
    return lo;
  };
  for (const run of body.textRuns || []) {
    for (let index = firstEndingAfter(run.st); index < spans.length && spans[index].start < run.ed; index++) {
      const { start, end, value } = spans[index];
      value.runs.push({ st: Math.max(run.st, start) - start, ed: Math.min(run.ed, end) - start, ts: run.ts || {} });
    }
  }
  for (const range of body.customRanges || []) {
    const span = spans[firstEndingAfter(range.startIndex)];
    if (span && range.startIndex >= span.start && range.endIndex < span.end) span.value.ranges.push({ ...range, startIndex: range.startIndex - span.start, endIndex: range.endIndex - span.start });
  }
  return result;
}
const semanticCell = cell => cell && Object.fromEntries(Object.entries(cell).filter(([k]) => k !== "s" && (!["v", "t"].includes(k) || !cell.f)));
export function validateImportedReplacement(current, next) {
  const meta = officeImportMetadata(current), after = officeImportMetadata(next);
  if (!same(meta, after)) fail("OFFICE_IMPORT_IDENTITY_CHANGED");
  if (!meta) return;
  const a = current.snapshot, b = next.snapshot;
  if (a.id !== b.id || !same(current.assetIds, next.assetIds)) fail("OFFICE_IMPORT_IDENTITY_CHANGED");
  if (meta.format === "xlsx") {
    if (!same(a.sheetOrder, b.sheetOrder) || !same(a.dateSystem, b.dateSystem)) fail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
    for (const id of a.sheetOrder) {
      const old = a.sheets[id], sheet = b.sheets[id], protection = meta.protection[id];
      for (const key of ["id", "name", "mergeData", "freeze", "rowData", "columnData", "hidden", "defaultStyle", "defaultColumnWidth", "defaultRowHeight"]) if (!same(old[key], sheet?.[key])) fail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
      const addresses = protection.readOnly ? [...new Set([...Object.keys(old.cellData || {}), ...Object.keys(sheet.cellData || {})])].flatMap(r => [...new Set([...Object.keys(old.cellData[r] || {}), ...Object.keys(sheet.cellData[r] || {})])].map(c => [Number(r), Number(c)]))
        : protection.cells.map(ref => { const match = /^([A-Z]+)([0-9]+)$/.exec(ref); let column = 0; for (const ch of match[1]) column = column * 26 + ch.charCodeAt(0) - 64; return [Number(match[2]) - 1, column - 1]; });
      for (const [r, c] of addresses) {
        const before = old.cellData[r]?.[c], cell = sheet.cellData[r]?.[c];
        const style = (snapshot, value) => typeof value?.s === "string" ? snapshot.styles?.[value.s] : value?.s;
        if (!same(semanticCell(before), semanticCell(cell)) || !same(style(a, before), style(b, cell))) fail("OFFICE_CELL_PROTECTED");
      }
    }
  } else if (meta.format === "docx") {
    for (const key of ["documentStyle", "lists", "tableSource", "drawings", "drawingsOrder"]) if (!same(a[key], b[key])) fail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
    if (!same(Object.keys(a.headers || {}), Object.keys(b.headers || {})) || !same(Object.keys(a.footers || {}), Object.keys(b.footers || {}))) fail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
    for (const segment of ["", ...Object.keys(a.headers || {}), ...Object.keys(a.footers || {})]) {
      const before = importedParagraphs(a, segment), after = importedParagraphs(b, segment);
      if (!same([...before.keys()], [...after.keys()])) fail("OFFICE_DOCUMENT_STRUCTURE_PROTECTED");
      for (const [id, value] of before) {
        const next = after.get(id);
        if (same(value, next)) continue;
        if (meta.protection.some(p => p.segmentId === segment && p.paragraphId === id)) fail("OFFICE_DOCUMENT_RANGE_PROTECTED");
        if (!same(value.bullet, next.bullet) || !same(value.ranges.map(r => r.properties), next.ranges.map(r => r.properties))) fail("OFFICE_DOCUMENT_STRUCTURE_PROTECTED");
      }
    }
  } else fail("OFFICE_FORMAT_UNSUPPORTED");
}
