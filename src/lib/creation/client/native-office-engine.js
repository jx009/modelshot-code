// Only called by an asynchronously loaded, type-specific browser runtime.
// No module-level engine singleton: each mounted editor owns its whole lifetime.
// These pinned 1.2.0 mutations are formula transport notifications whose own
// handlers return true without changing document data. User cell/style/formula
// changes still count; computed caches are included in the next authored save.
const formulaSignals = new Set([
  "set-trigger-formula-calculation-start", "set-formula-calculation-start", "set-formula-calculation-stop",
  "set-formula-calculation-notification", "set-formula-calculation-result",
  "set-formula-string-batch-calculation", "set-formula-string-batch-calculation-result",
].map(id => `formula.mutation.${id}`));
export function startNativeOfficeEngine({ library, preset, container, kind, snapshot, locale, localePack, workerLease, signal, onMutation, onError, readDocumentSelection, readPendingInput }) {
  let engine, api, unit, subscription, disposed = false, sequence = 0, composing = false, compositionText = "", mountContainer = container;
  const ownerDocument = container?.ownerDocument;
  const ownsInput = target => container?.contains?.(target);
  const compositionStart = event => { if (!disposed && ownsInput(event.target)) { composing = true; compositionText = ""; onMutation?.(sequence); } };
  const compositionUpdate = event => { if (!disposed && composing && ownsInput(event.target)) { compositionText = event.data || ""; onMutation?.(sequence); } };
  const compositionEnd = event => { if (!disposed && composing && ownsInput(event.target)) { composing = false; compositionText = ""; onMutation?.(sequence); } };
  const input = event => { if (!disposed && ownsInput(event.target)) onMutation?.(sequence); };
  const cleanup = () => {
    if (disposed) return;
    disposed = true; signal?.removeEventListener("abort", abort);
    ownerDocument?.removeEventListener("compositionstart", compositionStart, { capture: true });
    ownerDocument?.removeEventListener("compositionupdate", compositionUpdate, { capture: true });
    ownerDocument?.removeEventListener("compositionend", compositionEnd, { capture: true });
    ownerDocument?.removeEventListener("input", input, { capture: true });
    const errors = [];
    // Disconnect work immediately. Univer owns a separate React root; unmount
    // it after the host's commit, inside a per-instance detached container so an
    // Activity reconnect/new editor cannot be removed by the old instance.
    for (const release of [() => subscription?.dispose(), () => workerLease?.dispose(), () => { if (mountContainer !== container) mountContainer.remove(); }]) {
      try { release(); } catch (error) { errors.push(error); }
    }
    queueMicrotask(() => {
      const failures = [];
      for (const release of [() => unit?.dispose(), () => api?.disposeUnit(snapshot.id), () => api?.dispose(), () => engine?.dispose()]) {
        try { release(); } catch (error) { failures.push(error); }
      }
      if (failures.length) onError?.(new AggregateError(failures, "NATIVE_OFFICE_DISPOSE_FAILED"));
    });
    if (errors.length) throw new AggregateError(errors, "NATIVE_OFFICE_DISPOSE_FAILED");
  };
  const abort = () => { try { cleanup(); } catch (error) { onError?.(error); } };
  try {
    signal?.throwIfAborted();
    if (!["sheet", "document"].includes(kind) || !container || !snapshot?.id) throw new Error("NATIVE_OFFICE_SNAPSHOT_INVALID");
    if (kind === "sheet" && !workerLease) throw new Error("NATIVE_OFFICE_WORKER_REQUIRED");
    if (ownerDocument?.createElement) {
      mountContainer = ownerDocument.createElement("div");
      mountContainer.style.cssText = "position:absolute;inset:0;overflow:hidden";
      container.append(mountContainer);
    }
    // Hold the instance before plugin registration so a failed plugin can be
    // disposed as well. createUniver() returns only after registration finishes.
    engine = new library.Univer({ locale, locales: { [locale]: localePack }, logLevel: library.LogLevel.WARN, undoRedoHistoryLimit: 50 });
    const configuration = preset({ container: mountContainer, disableAutoFocus: true, ...(workerLease ? { workerURL: workerLease.worker } : {}) });
    for (const plugin of configuration.plugins) {
      const [type, options] = Array.isArray(plugin) ? plugin : [plugin];
      engine.registerPlugin(type, options);
    }
    api = library.FUniver.newAPI(engine);
    // The engine may mutate its input while normalizing it; do not let that
    // mutate the persisted snapshot or an idempotent request still in flight.
    const data = structuredClone(snapshot);
    unit = kind === "sheet" ? api.createWorkbook(data) : api.createDocument(data);
    subscription = api.addEvent(api.Event.CommandExecuted, event => {
      if (!disposed && kind === "sheet" && event.id === "sheet.operation.set-cell-edit-visible") onMutation?.(sequence);
      if (disposed || event.type !== library.CommandType.MUTATION || event.params?.unitId && event.params.unitId !== snapshot.id) return;
      if (kind === "sheet" && formulaSignals.has(event.id)) return;
      if (kind === "sheet" && event.options?.onlyLocal === true && event.options?.fromSync === true
        && (event.id === "formula.mutation.set-array-formula-data"
          || event.id === "sheet.mutation.set-range-values" && event.options.fromFormula === true && event.options.applyFormulaCalculationResult === true)) return;
      // No serialization/save/React snapshot on each key, scroll or selection.
      sequence++; onMutation?.(sequence);
    });
    ownerDocument?.addEventListener("compositionstart", compositionStart, true);
    ownerDocument?.addEventListener("compositionupdate", compositionUpdate, true);
    ownerDocument?.addEventListener("compositionend", compositionEnd, true);
    ownerDocument?.addEventListener("input", input, true);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { cleanup(); signal.throwIfAborted(); }
    return {
      get sequence() { return sequence; },
      // endEditingAsync in 1.2.0 resolves after a timer, not after asynchronous
      // cell validation. Never treat that boolean as a durable commit barrier.
      // Ask the user to confirm the cell/IME before explicit save/navigation.
      isInputPending() { return composing || kind === "sheet" && unit.isCellEditing(); },
      pendingInput() {
        if (disposed) throw new Error("ARTIFACT_CLOSED");
        if (kind !== "sheet" || !unit.isCellEditing() || !readPendingInput) return null;
        const value = readPendingInput(engine, { composing });
        return value ? { ...value, composing, compositionText } : null;
      },
      sheetSelection() {
        if (disposed) throw new Error("ARTIFACT_CLOSED");
        if (kind !== "sheet") throw new Error("LANGUAGE_SELECTION_CHANGED");
        const range = unit.getActiveRange();
        if (!range) throw new Error("LANGUAGE_SELECTION_CHANGED");
        // Explicit reference action only; never read grid data on selection.
        return { unitId: snapshot.id, sheetId: range.getSheetId(), range: { ...range.getRange() } };
      },
      documentSelection() {
        if (disposed) throw new Error("ARTIFACT_CLOSED");
        if (kind !== "document" || !readDocumentSelection) throw new Error("LANGUAGE_SELECTION_CHANGED");
        return readDocumentSelection(engine);
      },
      snapshot() { if (disposed) throw new Error("ARTIFACT_CLOSED"); return structuredClone(unit.save()); },
      dispose: cleanup,
    };
  } catch (error) {
    try { cleanup(); } catch (failure) { onError?.(failure); }
    throw error;
  }
}
