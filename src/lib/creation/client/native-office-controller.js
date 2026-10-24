import { assertNativeOfficeRuntimeContent } from "./native-office-policy.js";
import { nativeOfficeArtifactSchema } from "../contracts/native-office.js";
import { nativeSheetCellsFromRange, validateNativeSheetSelection } from "../native-sheet-edit.js";
import { NATIVE_SHEET_EDIT_FORMAT } from "../contracts/native-sheet-edit.js";
import { nativeDocumentSelection } from "../native-document-edit.js";
import { createNativeSheetInputRecovery } from "./native-sheet-input.js";

// Owns one mounted editor. React receives status changes, never per-keystroke
// snapshots. Session and runtime ports keep lifecycle tests independent of WebGL.
export function createNativeOfficeController({ session, loadRuntime, container, kind, locale, signal, onState, onError }) {
  let engine, closed = false, ready = false, fatal = null, captured = 0, localTimer, cloudTimer, firstChange = 0, saving, unsnapshotted = false, inputPending = false;
  const inputRecovery = kind === "sheet" && session.readInputDraft ? createNativeSheetInputRecovery({ read: session.readInputDraft, write: session.writeInputDraft }) : null;
  const alive = () => !closed && !signal?.aborted;
  const assertReady = () => { if (!alive()) throw new Error("ARTIFACT_CLOSED"); if (fatal) throw fatal; if (!ready) throw new Error("ARTIFACT_NOT_READY"); };
  const publish = () => { if (alive()) onState?.({ ...session.getState(), ready, unsnapshotted, inputPending, fatal, recoveredInputs: inputRecovery?.getState() || [] }); };
  const report = error => { if (alive()) { onError?.(error); publish(); } };
  const clearTimers = () => { clearTimeout(localTimer); clearTimeout(cloudTimer); localTimer = cloudTimer = null; };
  const pending = () => Boolean(engine?.isInputPending());
  const assertReviewed = () => { if (inputRecovery?.getState().length) throw new Error("NATIVE_OFFICE_INPUT_RECOVERY_REQUIRED"); };
  function backupInput() {
    if (inputRecovery && pending()) inputRecovery.capture(engine.pendingInput?.(), session.getState().revision);
    return inputRecovery?.persist();
  }
  function capture() {
    if (!engine || pending() || engine.sequence === captured) return false;
    const state = session.getState(), snapshot = engine.snapshot();
    const title = kind === "sheet" ? snapshot.name : snapshot.title || state.content.title;
    // Preserve all valid authored data even when a newly added feature would
    // need a future runtime adapter to reopen. Admission is never lossy storage.
    const content = nativeOfficeArtifactSchema.parse({ ...state.content, title, snapshot });
    session.change(content); captured = engine.sequence; unsnapshotted = false; firstChange = 0;
    publish(); return true;
  }
  function mutation() {
    if (!alive() || !ready) return;
    const nowPending = pending();
    if (nowPending !== inputPending) { inputPending = nowPending; publish(); }
    if (!unsnapshotted && engine?.sequence !== captured) { unsnapshotted = true; publish(); }
    firstChange ||= Date.now();
    clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      void persist();
      if (pending()) firstChange = 0;
    }, Math.min(800, Math.max(0, 5000 - (Date.now() - firstChange))));
    // At most one scheduled cloud flush, with no automatic retry storm on error.
    if (!cloudTimer && !["conflict", "copying", "copied", "error"].includes(session.getState().status)) cloudTimer = setTimeout(() => {
      cloudTimer = null;
      if (!pending()) void flush().catch(report);
    }, 5000);
  }
  function changed() { publish(); }
  async function open() {
    try {
      try { await session.open(); }
      catch (error) { if (session.getState().status !== "conflict") throw error; }
      signal?.throwIfAborted(); if (closed) throw new Error("ARTIFACT_CLOSED");
      const state = session.getState();
      await inputRecovery?.open();
      signal?.throwIfAborted(); if (closed) throw new Error("ARTIFACT_CLOSED");
      if (state.copyResult) { ready = true; publish(); return; }
      const content = assertNativeOfficeRuntimeContent(state.content);
      if (content.kind !== kind) throw new Error("ARTIFACT_KIND_MISMATCH");
      const runtime = await loadRuntime(kind, { signal });
      signal?.throwIfAborted(); if (closed) throw new Error("ARTIFACT_CLOSED");
      engine = await runtime.mount({ container, snapshot: content.snapshot, locale, signal, onMutation: mutation,
        onError: error => { fatal = error; container.inert = true; void persist(); report(error); },
      });
      if (!alive()) { engine.dispose(); engine = null; return; }
      ready = true; captured = engine.sequence; container.inert = Boolean(inputRecovery?.getState().length); publish();
      if (state.dirty && state.status !== "conflict" && !inputRecovery?.getState().length) cloudTimer = setTimeout(() => { cloudTimer = null; void flush().catch(report); }, 5000);
    } catch (error) { if (alive()) { fatal = error; publish(); throw error; } }
  }
  function flush() {
    try { assertReady(); assertReviewed(); } catch (error) { return Promise.reject(error); }
    if (session.getState().copyResult) return Promise.resolve(session.getState().copyResult);
    if (saving) return saving;
    clearTimers();
    saving = (async () => {
      // Let the input event's queued commands finish; this is not a replacement
      // for confirmation of an active cell or IME composition.
      await new Promise(resolve => setTimeout(resolve, 0)); assertReady();
      if (pending()) { await backupInput(); throw new Error("NATIVE_OFFICE_INPUT_PENDING"); }
      capture();
      let result;
      do {
        result = await session.flush(); assertReady();
        if (pending()) { await backupInput(); throw new Error("NATIVE_OFFICE_INPUT_PENDING"); }
      } while (capture());
      await inputRecovery?.settle(result.content);
      clearTimers();
      return result;
    })().finally(() => { saving = null; });
    return saving;
  }
  async function copy(title) {
    assertReady(); assertReviewed();
    if (pending()) throw new Error("NATIVE_OFFICE_INPUT_PENDING");
    capture();
    container.inert = true;
    try { return await session.saveConflictCopy(title); }
    finally { if (alive()) container.inert = Boolean(session.getState().copyPending); }
  }
  async function reference() {
    assertReady(); assertReviewed();
    if (pending()) throw new Error("NATIVE_OFFICE_INPUT_PENDING");
    if (!engine || session.getState().copyPending) throw new Error("LANGUAGE_SELECTION_CHANGED");
    const sequence = engine.sequence, selected = kind === "sheet" ? engine.sheetSelection() : engine.documentSelection();
    const cells = kind === "sheet" ? nativeSheetCellsFromRange(selected.range) : null;
    const saved = await flush(); assertReady();
    if (engine.sequence !== sequence) throw new Error("LANGUAGE_SELECTION_CHANGED");
    if (kind === "document") return { ...nativeDocumentSelection(saved.content, selected), baseRevision: saved.revision };
    const target = { format: NATIVE_SHEET_EDIT_FORMAT, unitId: selected.unitId, sheetId: selected.sheetId, cells, baseRevision: saved.revision };
    const { sheet } = validateNativeSheetSelection(target, saved.content);
    return { ...target, sheetName: sheet.name };
  }
  function persist() {
    if (!alive() || !ready || session.getState().copyPending) return;
    // Reserve both keys before returning, including during unexpected unmount.
    // Never let a failed small input backup prevent the ordinary draft write.
    let inputTask, snapshotTask;
    try { inputTask = backupInput(); } catch (error) { report(error); }
    try {
      if (capture() || session.getState().dirty) {
        snapshotTask = session.persist();
        if (!pending()) inputTask = Promise.all([inputTask, inputRecovery?.settle(session.getState().content, () => snapshotTask)]);
      }
    } catch (error) { report(error); }
    return Promise.all([inputTask, snapshotTask]).catch(report);
  }
  async function dismissRecoveredInputs() {
    assertReady();
    await inputRecovery?.dismiss();
    if (!alive()) return;
    container.inert = Boolean(fatal || session.getState().copyPending); publish();
  }
  function hasUnsaved() {
    const state = session.getState();
    if (state.copyResult) return false;
    return Boolean(pending() || unsnapshotted || state.dirty || state.copyPending);
  }
  function dispose() {
    if (closed) return;
    // Reserve the IndexedDB write before close; the next mount's read follows it.
    persist(); closed = true; ready = false; clearTimers(); session.dispose();
    try { engine?.dispose(); } catch (error) { onError?.(error); }
    engine = null;
  }
  return { open, flush, copy, reference, persist, dismissRecoveredInputs, hasUnsaved, changed, dispose };
}
