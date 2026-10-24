import { nativeOfficeArtifactSchema } from "./contracts/native-office.js";
import { NATIVE_DOCUMENT_EDIT_FORMAT, nativeDocumentSpansSchema, nativeDocumentOperationsSchema, nativeDocumentTargetSchema } from "./contracts/native-document-edit.js";
import { assertNativeOfficeRuntimeContent } from "./client/native-office-policy.js";

export class NativeDocumentEditError extends Error {
  constructor(code) { super(code); this.name = "NativeDocumentEditError"; this.code = code; }
}
const fail = code => { throw new NativeDocumentEditError(code); };
const knownBodyKeys = new Set(["dataStream", "textRuns", "paragraphs", "sectionBreaks", "tables", "customBlocks", "customRanges", "customDecorations", "renderedPageBreaks"]);
const populated = value => value != null && (typeof value !== "object" ? value !== "" : Object.keys(value).length > 0);
const boundary = (text, offset) => Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length
  && !(offset > 0 && offset < text.length && /[\ud800-\udbff]/.test(text[offset - 1]) && /[\udc00-\udfff]/.test(text[offset]));
const control = /[\u0000-\u001f\ufffe\uffff]/;

function bodyFor(snapshot, segmentId) {
  if (segmentId === "") return snapshot.body;
  const matches = [snapshot.headers, snapshot.footers].filter(stories => stories && Object.hasOwn(stories, segmentId));
  if (matches.length !== 1) fail("LANGUAGE_SELECTION_CHANGED");
  return matches[0][segmentId].body;
}

// Closed positional vocabulary. Unknown positional metadata cannot silently
// retain stale offsets. Storage still preserves such files in full; AI refuses
// until its adapter knows how to move the additional metadata.
function checkBody(body) {
  if (!body || typeof body.dataStream !== "string" || !body.dataStream.isWellFormed()) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
  const text = body.dataStream;
  for (const [key, value] of Object.entries(body)) if (!knownBodyKeys.has(key) && populated(value)) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
  for (const key of knownBodyKeys) if (key !== "dataStream" && body[key] !== undefined && !Array.isArray(body[key])) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
  let previous = -1;
  for (const run of body.textRuns || []) {
    if (!boundary(text, run.st) || !boundary(text, run.ed) || run.ed <= run.st || run.st < previous) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
    previous = run.ed;
  }
  for (const [key, token] of [["paragraphs", "\r"], ["sectionBreaks", "\n"], ["customBlocks", "\b"]]) {
    previous = -1;
    for (const item of body[key] || []) {
      if (!boundary(text, item.startIndex) || item.startIndex <= previous || text[item.startIndex] !== token) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
      previous = item.startIndex;
    }
  }
  for (const table of body.tables || []) if (!boundary(text, table.startIndex) || !boundary(text, table.endIndex) || table.endIndex <= table.startIndex
    || text[table.startIndex] !== "\x1a" || text[table.endIndex - 1] !== "\x0f") fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
  for (const key of ["customRanges", "customDecorations"]) for (const item of body[key] || []) {
    if (!boundary(text, item.startIndex) || !boundary(text, item.endIndex + 1) || item.endIndex < item.startIndex) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
  }
  for (const offset of body.renderedPageBreaks || []) if (!boundary(text, offset) || text[offset] !== "\f") fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
  return body;
}

function sourceFor(source, unitId, segmentId) {
  if (source?.kind !== "document" || source.schemaVersion !== 2) fail("LANGUAGE_SOURCE_MISMATCH");
  const content = assertNativeOfficeRuntimeContent(source);
  if (content.snapshot.id !== unitId) fail("LANGUAGE_SELECTION_CHANGED");
  if (content.snapshot.disabled) fail("NATIVE_DOCUMENT_AI_PROTECTED");
  // The legacy note payload is opaque in 1.2.0. Its anchoring semantics are not
  // defined by the runtime, so do not guess how to rebase it.
  if (content.snapshot.resources?.some(resource => resource.name === "DOC_NOTE_PLUGIN" && resource.data && resource.data !== "{}")) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
  return { content, body: checkBody(bodyFor(content.snapshot, segmentId)) };
}

function checkSpan(span, body) {
  const text = body.dataStream;
  if (!boundary(text, span.start) || !boundary(text, span.end) || text.slice(span.start, span.end) !== span.expectedText) fail("LANGUAGE_SELECTION_CHANGED");
  if (!span.expectedText || control.test(span.expectedText)) fail("NATIVE_DOCUMENT_TEXT_UNSUPPORTED");
  // A replacement inherits exactly one explicit style, including named styles.
  // Splitting the source selection at these boundaries prevents flattening it.
  const runs = (body.textRuns || []).filter(run => run.st < span.end && run.ed > span.start);
  if (runs.length > 1 || runs.length === 1 && (runs[0].st > span.start || runs[0].ed < span.end)) fail("NATIVE_DOCUMENT_AI_STYLE_BOUNDARY");
  for (const range of body.customRanges || []) if (range.startIndex < span.end && range.endIndex >= span.start) {
    if (range.rangeType !== 0 || range.wholeEntity || !(range.startIndex < span.start && range.endIndex >= span.end)) fail("NATIVE_DOCUMENT_AI_PROTECTED");
  }
  for (const range of body.customDecorations || []) if (range.startIndex < span.end && range.endIndex >= span.start
    && (range.type !== 0 || range.startIndex > span.start || range.endIndex + 1 < span.end)) fail("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
}

export function validateNativeDocumentSelection(input, source) {
  const { content, body } = sourceFor(source, input.unitId, input.segmentId), spans = nativeDocumentSpansSchema.parse(input.spans);
  spans.forEach(span => checkSpan(span, body));
  return { content, body, spans };
}

export function nativeDocumentSelection(source, selected) {
  const { unitId, segmentId, start, end } = selected;
  const { body } = sourceFor(source, unitId, segmentId), text = body.dataStream;
  if (!boundary(text, start) || !boundary(text, end) || start >= end || end - start > 16000) fail("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
  const boundaries = new Set([start, end]);
  const add = position => { if (position > start && position < end) boundaries.add(position); };
  for (const run of body.textRuns || []) { add(run.st); add(run.ed); }
  for (const range of body.customDecorations || []) { add(range.startIndex); add(range.endIndex + 1); }
  for (let index = start; index < end; index++) if (control.test(text[index])) { add(index); add(index + 1); }
  const positions = [...boundaries].sort((a, b) => a - b), spans = [];
  for (let index = 1; index < positions.length; index++) {
    const first = positions[index - 1], last = positions[index], expectedText = text.slice(first, last);
    if (control.test(expectedText)) continue; // Keep existing structural tokens verbatim.
    if (spans.length >= 64) fail("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
    const span = { start: first, end: last, expectedText };
    checkSpan(span, body); spans.push(span);
  }
  if (!spans.length || spans.reduce((sum, span) => sum + span.expectedText.length, 0) > 12000) fail("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
  return { format: NATIVE_DOCUMENT_EDIT_FORMAT, unitId, segmentId, spans: nativeDocumentSpansSchema.parse(spans) };
}

export function nativeDocumentPromptSource(input, source) {
  const { body, spans } = validateNativeDocumentSelection(input, source);
  return { title: source.title, segmentId: input.segmentId, spans: spans.map(span => ({ ...span,
    paragraphId: body.paragraphs?.find(paragraph => paragraph.startIndex >= span.end)?.paragraphId || null,
  })) };
}

function replaceSpans(body, sortedOperations) {
  const operations = sortedOperations.filter(operation => operation.text !== operation.expectedText);
  if (!operations.length) return;
  const cumulative = []; let delta = 0;
  for (const { start, end, text } of operations) { delta += text.length - (end - start); cumulative.push(delta); }
  // One pass over each metadata array, with a bounded binary lookup per offset.
  // Never rebuild a 300k-character body once per replacement.
  const shift = offset => {
    let low = 0, high = operations.length;
    while (low < high) { const middle = (low + high) >>> 1; if (operations[middle].end <= offset) low = middle + 1; else high = middle; }
    return offset + (low ? cumulative[low - 1] : 0);
  };
  // A uniformly styled span can only be enclosed by a run or lie in a gap.
  if (body.textRuns) body.textRuns = body.textRuns.flatMap(run => {
    const next = { ...run, st: shift(run.st), ed: shift(run.ed) };
    return next.ed > next.st ? [next] : [];
  });
  for (const key of ["paragraphs", "sectionBreaks", "customBlocks"]) for (const item of body[key] || []) item.startIndex = shift(item.startIndex);
  for (const item of body.tables || []) { item.startIndex = shift(item.startIndex); item.endIndex = shift(item.endIndex); }
  for (const key of ["customRanges", "customDecorations"]) if (body[key]) body[key] = body[key].flatMap(item => {
    const next = { ...item, startIndex: shift(item.startIndex), endIndex: shift(item.endIndex + 1) - 1 };
    return next.endIndex >= next.startIndex ? [next] : [];
  });
  if (body.renderedPageBreaks) body.renderedPageBreaks = body.renderedPageBreaks.map(shift);
  const chunks = []; let cursor = 0;
  for (const { start, end, text } of operations) { chunks.push(body.dataStream.slice(cursor, start), text); cursor = end; }
  chunks.push(body.dataStream.slice(cursor)); body.dataStream = chunks.join("");
}

export function applyNativeDocumentOperations(source, rawOperations, scope) {
  const operations = nativeDocumentOperationsSchema.parse(rawOperations);
  const segmentId = operations[0].segmentId;
  const { content, body } = sourceFor(source, source?.snapshot?.id, segmentId);
  if (scope) validateNativeDocumentSelection(scope, content);
  const sorted = [...operations].sort((a, b) => a.start - b.start);
  for (const [index, operation] of sorted.entries()) {
    if (operation.segmentId !== segmentId || index && operation.start < sorted[index - 1].end) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
    if (scope && (segmentId !== scope.segmentId || !scope.spans.some(span => span.start === operation.start && span.end === operation.end && span.expectedText === operation.expectedText))) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
    checkSpan(operation, body);
    if (!operation.text && (body.customDecorations || []).some(range => range.startIndex === operation.start && range.endIndex + 1 === operation.end)) fail("NATIVE_DOCUMENT_AI_PROTECTED");
  }
  const next = structuredClone(content), nextBody = bodyFor(next.snapshot, segmentId);
  // Every operation refers to the original revision; transform metadata once.
  replaceSpans(nextBody, sorted);
  // Several independently styled spans may jointly delete an entire comment
  // anchor even though no individual operation covered that whole annotation.
  if ((nextBody.customDecorations?.length || 0) !== (body.customDecorations?.length || 0)) fail("NATIVE_DOCUMENT_AI_PROTECTED");
  checkBody(nextBody);
  return nativeOfficeArtifactSchema.parse(next);
}

export function nativeDocumentTargetFromReference(reference, saved, artifactId) {
  if (reference.artifactId !== artifactId || reference.baseRevision !== saved.revision) fail("LANGUAGE_SELECTION_CHANGED");
  const { format, unitId, segmentId, spans } = reference;
  const target = nativeDocumentTargetSchema.parse({ format, unitId, segmentId, spans, artifactId, baseRevision: saved.revision });
  validateNativeDocumentSelection(target, saved.content);
  return target;
}
