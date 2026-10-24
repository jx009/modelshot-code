import { z } from "zod";

const id = z.string().min(1).max(128);
const text = z.string().max(32768);
const inputSchema = z.object({
  unitId: id, sheetId: id, row: z.number().int().min(0).max(99999), column: z.number().int().min(0).max(1023),
  text, compositionText: text.default(""), composing: z.boolean(),
}).strict();
const entrySchema = inputSchema.extend({ revision: z.number().int().positive(), capturedAt: z.number().int().nonnegative() }).strict();
const draftSchema = z.object({ format: z.literal("univer-sheet-input-1"), entries: z.array(entrySchema).max(8) }).strict();
const sameCell = (a, b) => a.unitId === b.unitId && a.sheetId === b.sheetId && a.row === b.row && a.column === b.column;

// Read the active editor document, not the bridge's initial cell model. The
// latter still contains the value from before F2/typing in pinned Univer 1.2.
export function readNativeSheetInput({ bridge, instances, documentType, unitId, composing = false }) {
  if (!bridge.isVisible()?.visible || !composing && !bridge.getEditorDirty()) return null;
  const target = bridge.getEditCellState();
  if (!target || target.unitId !== unitId) return null;
  const body = instances.getUnit(bridge.getCurrentEditorId(), documentType)?.getBody();
  if (typeof body?.dataStream !== "string" || !body.dataStream.endsWith("\r\n")) throw new Error("NATIVE_OFFICE_INPUT_BACKUP_UNAVAILABLE");
  if (body.dataStream.length > 32770) throw new Error("NATIVE_OFFICE_INPUT_BACKUP_LIMIT");
  // Keep internal line breaks, formulas and whitespace verbatim. Only remove
  // the mandatory terminal paragraph/section markers.
  return { unitId, sheetId: target.sheetId, row: target.row, column: target.column, text: body.dataStream.slice(0, -2) };
}

function inSnapshot(entry, content) {
  if (entry.composing || entry.compositionText || content?.kind !== "sheet" || content.snapshot.id !== entry.unitId) return false;
  const sheet = content.snapshot.sheets[entry.sheetId];
  if (!sheet) return false;
  const cell = sheet.cellData?.[entry.row]?.[entry.column];
  // Only exact confirmed content is proof. Formatted numbers/dates and rich
  // structures may differ; retaining a backup is safer than guessing a match.
  const value = typeof cell?.f === "string" ? cell.f : cell?.p?.body?.dataStream?.endsWith("\r\n") ? cell.p.body.dataStream.slice(0, -2) : cell?.v ?? "";
  return typeof value === "string" && value === entry.text;
}

// A small, separate IndexedDB record: never serialize the whole workbook for
// an unconfirmed keypress. The shared draft port owns write/read ordering.
export function createNativeSheetInputRecovery({ read, write }) {
  let entries = [], reviewed = true, changed = false;
  const state = () => reviewed ? [] : entries;
  async function open() {
    const draft = await read();
    const parsed = draft ? draftSchema.safeParse(draft) : null;
    if (parsed && !parsed.success) throw new Error("NATIVE_OFFICE_INPUT_BACKUP_UNAVAILABLE");
    entries = parsed?.data.entries || [];
    reviewed = !entries.length;
    return state();
  }
  function capture(input, revision) {
    if (!reviewed || !input) return false;
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new Error("NATIVE_OFFICE_INPUT_BACKUP_LIMIT");
    const index = entries.findIndex(entry => sameCell(entry, parsed.data));
    const previous = entries[index];
    if (previous && previous.text === parsed.data.text && previous.compositionText === parsed.data.compositionText && previous.composing === parsed.data.composing) return false;
    if (index < 0 && entries.length >= 8) throw new Error("NATIVE_OFFICE_INPUT_BACKUP_LIMIT");
    const next = { ...parsed.data, revision, capturedAt: Date.now() };
    entries = index < 0 ? [...entries, next] : entries.map((entry, i) => i === index ? next : entry);
    changed = true; return true;
  }
  function persist(prepare) {
    if (!changed) return Promise.resolve();
    const snapshot = entries.length ? { format: "univer-sheet-input-1", entries } : null;
    changed = false;
    // Reserve now, before an Activity remount reads the same key. Failures keep
    // the record dirty for a later explicit save, with no background retry loop.
    try { return Promise.resolve(write(snapshot, prepare)).catch(error => { changed = true; throw error; }); }
    catch (error) { changed = true; return Promise.reject(error); }
  }
  function settle(content, prepare) {
    if (!reviewed || !entries.length) return Promise.resolve();
    const remaining = entries.filter(entry => !inSnapshot(entry, content));
    if (remaining.length === entries.length) return persist();
    const removed = entries.filter(entry => !remaining.includes(entry));
    // The deletion may run only after the confirmed workbook draft is durable.
    // Retain records in memory until ACK too; otherwise a failed prerequisite
    // could make the next retry delete the only backup, or evade the capacity.
    const snapshot = remaining.length ? { format: "univer-sheet-input-1", entries: remaining } : null;
    try {
      return Promise.resolve(write(snapshot, prepare)).then(() => {
        entries = entries.filter(entry => !removed.includes(entry));
      }).catch(error => { changed = true; throw error; });
    } catch (error) { changed = true; return Promise.reject(error); }
  }
  async function dismiss() {
    // Do not unlock or discard the in-memory recovery until storage confirms.
    await write(null);
    entries = []; reviewed = true; changed = false;
  }
  return { open, capture, persist, settle, dismiss, getState: state };
}
