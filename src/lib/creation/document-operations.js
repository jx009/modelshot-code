// Copy-on-write operations preserve untouched section/block identities. The
// editor adapter supplies validated operations; full validation occurs on save.
export class DocumentOperationError extends Error {
  constructor(code) { super(code); this.name = "DocumentOperationError"; this.code = code; }
}
const fail = code => { throw new DocumentOperationError(code); };
const marksEqual = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
function append(runs, text, marks) {
  if (!text) return;
  const last = runs.at(-1);
  if (last && marksEqual(last.marks, marks)) last.text += text;
  else runs.push({ text, marks: { ...marks } });
}
function splitSurrogate(text, offset) { return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]); }
export function replaceDocumentText(runs, op) {
  const full = runs.map(run => run.text).join("");
  if (!Number.isInteger(op.start) || !Number.isInteger(op.end) || op.start < 0 || op.end < op.start || op.end > full.length || splitSurrogate(full, op.start) || splitSurrogate(full, op.end)) fail("DOCUMENT_RANGE_INVALID");
  if (full.slice(op.start, op.end) !== op.expectedText) fail("DOCUMENT_TEXT_CHANGED");
  if (full.length - (op.end - op.start) + op.text.length > 16000) fail("DOCUMENT_TEXT_LIMIT");
  if (op.expectedText === op.text) return runs;
  const result = []; let offset = 0, inserted = false;
  for (const run of runs) {
    const end = offset + run.text.length;
    if (end <= op.start) append(result, run.text, run.marks);
    else {
      if (offset < op.start) append(result, run.text.slice(0, op.start - offset), run.marks);
      if (!inserted) { append(result, op.text, run.marks); inserted = true; }
      if (end > op.end) append(result, run.text.slice(Math.max(0, op.end - offset)), run.marks);
    }
    offset = end;
  }
  if (!inserted) append(result, op.text, runs.at(-1)?.marks || {});
  if (result.length > 512) fail("DOCUMENT_RUN_LIMIT");
  return result;
}
function changeLeaf(block, op) {
  if (["paragraph", "heading"].includes(block.type) && block.id === op.leafId) return { ...block, runs: replaceDocumentText(block.runs, op) };
  if (block.type === "list") {
    const index = block.items.findIndex(item => item.id === op.leafId);
    if (index < 0) fail("DOCUMENT_LEAF_NOT_FOUND");
    const items = [...block.items]; items[index] = { ...items[index], runs: replaceDocumentText(items[index].runs, op) };
    return { ...block, items };
  }
  if (block.type === "table") {
    const rowIndex = block.rows.findIndex(row => row.cells.some(cell => cell.id === op.leafId));
    if (rowIndex < 0) fail("DOCUMENT_LEAF_NOT_FOUND");
    const row = block.rows[rowIndex], index = row.cells.findIndex(cell => cell.id === op.leafId), cells = [...row.cells], rows = [...block.rows];
    cells[index] = { ...cells[index], runs: replaceDocumentText(cells[index].runs, op) }; rows[rowIndex] = { ...row, cells };
    return { ...block, rows };
  }
  fail("DOCUMENT_LEAF_NOT_FOUND");
}
export function applyDocumentOperation(document, op) {
  if (op.op === "setDocumentTitle") return { ...document, title: op.title };
  if (op.op === "setDocumentPage") return { ...document, page: op.page };
  if (op.op === "setDocumentTheme") return { ...document, theme: op.theme };
  const si = document.sections.findIndex(section => section.id === op.sectionId), section = document.sections[si];
  if (!section) fail("DOCUMENT_SECTION_NOT_FOUND");
  const blocks = [...section.blocks], bi = blocks.findIndex(block => block.id === op.blockId), block = blocks[bi];
  if (op.op === "insertDocumentBlock") {
    if (section.blocks.length >= 300 || document.sections.reduce((total, item) => total + item.blocks.length, 0) >= 2000) fail("DOCUMENT_CONTENT_LIMIT");
    if (!Number.isInteger(op.index) || op.index < 0 || op.index > blocks.length) fail("DOCUMENT_POSITION_INVALID");
    if (document.sections.some(item => item.blocks.some(value => value.id === op.block.id))) fail("DUPLICATE_DOCUMENT_ID");
    blocks.splice(op.index, 0, op.block);
  } else {
    if (!block) fail("DOCUMENT_BLOCK_NOT_FOUND");
    if (op.op === "setDocumentLock") blocks[bi] = { ...block, locked: op.locked };
    else {
      if (block.locked) fail("DOCUMENT_BLOCK_LOCKED");
      if (op.op === "replaceDocumentText") blocks[bi] = changeLeaf(block, op);
      else if (op.op === "replaceDocumentBlock") {
        if (op.block.id !== block.id || op.block.locked !== block.locked) fail("DOCUMENT_BLOCK_IDENTITY_CHANGED");
        blocks[bi] = op.block;
      } else if (op.op === "removeDocumentBlock") {
        if (blocks.length === 1) fail("DOCUMENT_LAST_BLOCK_REQUIRED");
        blocks.splice(bi, 1);
      } else if (op.op === "moveDocumentBlock") {
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= blocks.length) fail("DOCUMENT_POSITION_INVALID");
        blocks.splice(bi, 1); blocks.splice(op.index, 0, block);
      } else fail("UNKNOWN_DOCUMENT_OPERATION");
    }
  }
  const sections = [...document.sections]; sections[si] = { ...section, blocks };
  return { ...document, sections };
}
export function applyDocumentOperations(document, operations) { return operations.reduce(applyDocumentOperation, document); }
export function applyDocumentWithInverse(document, operations) {
  let current = document; const inverse = [];
  for (const op of operations) {
    const next = applyDocumentOperation(current, op);
    let undo;
    if (op.op === "setDocumentTitle") undo = { ...op, title: current.title };
    else if (op.op === "setDocumentPage") undo = { ...op, page: current.page };
    else if (op.op === "setDocumentTheme") undo = { ...op, theme: current.theme };
    else if (op.op === "insertDocumentBlock") undo = { op: "removeDocumentBlock", sectionId: op.sectionId, blockId: op.block.id };
    else {
      const section = current.sections.find(item => item.id === op.sectionId), index = section.blocks.findIndex(item => item.id === op.blockId), block = section.blocks[index];
      if (op.op === "removeDocumentBlock") undo = { op: "insertDocumentBlock", sectionId: section.id, block, index };
      else if (op.op === "moveDocumentBlock") undo = { ...op, index };
      else if (op.op === "setDocumentLock") undo = { ...op, locked: block.locked };
      else undo = { op: "replaceDocumentBlock", sectionId: section.id, blockId: block.id, block };
    }
    if (op.op === "insertDocumentBlock" && op.block.locked) inverse.unshift({ op: "setDocumentLock", sectionId: op.sectionId, blockId: op.block.id, locked: false }, undo);
    else inverse.unshift(undo);
    current = next;
  }
  return { document: current, inverse };
}
