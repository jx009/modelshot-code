import { nativeOfficeArtifactSchema, saveNativeOfficeArtifactSchema, copyNativeOfficeArtifactSchema } from "../contracts/native-office.js";
import { validateImportedReplacement } from "../office/protection.js";

const fail = code => { throw new Error(code); };
const conflict = error => error?.code === "ARTIFACT_VERSION_CONFLICT" || error?.message === "ARTIFACT_VERSION_CONFLICT";
const version = value => Number.isSafeInteger(value) && value > 0;
const sequence = value => Number.isSafeInteger(value) && value >= 0;
function draftState(input, artifactId) {
  if (!input || input.draftVersion !== "univer-1" || input.artifactId !== artifactId || !version(input.baseRevision)
    || !sequence(input.generation) || !sequence(input.savedGeneration) || input.savedGeneration > input.generation) fail("NATIVE_OFFICE_DRAFT_INVALID");
  const content = nativeOfficeArtifactSchema.parse(input.content);
  const inflight = input.inflight ? saveNativeOfficeArtifactSchema.parse(input.inflight) : null;
  const copyRequest = input.copyRequest ? copyNativeOfficeArtifactSchema.parse(input.copyRequest) : null;
  if (inflight && (!sequence(input.inflightGeneration) || input.inflightGeneration > input.generation || input.inflightGeneration <= input.savedGeneration
    || inflight.baseRevision !== input.baseRevision || inflight.content.kind !== content.kind || inflight.content.snapshot.id !== content.snapshot.id)) fail("NATIVE_OFFICE_DRAFT_INVALID");
  if (copyRequest && (inflight || copyRequest.content.kind !== content.kind || copyRequest.content.snapshot.id !== content.snapshot.id)) fail("NATIVE_OFFICE_DRAFT_INVALID");
  return { baseRevision: input.baseRevision, content, generation: input.generation, savedGeneration: input.savedGeneration, inflight, inflightGeneration: inflight ? input.inflightGeneration : null, copyRequest };
}

// One latest immutable snapshot plus, only while saving, one fixed request.
// The editor captures after a pause or explicit flush, never for every key.
// Ports provide user/artifact/session-scoped IndexedDB and timeout-bounded API.
export function createNativeOfficeJournal({ artifactId, readDraft, writeDraft, load, save, copy, requestKey, onState, signal }) {
  let current = null, closed = false, opening = null, saving = null, copying = null, copyResult = null;
  let status = "loading", error = null;
  const assertOpen = () => { if (closed || signal?.aborted) fail("ARTIFACT_CLOSED"); };
  const dirty = () => Boolean(current && (current.generation > current.savedGeneration || current.inflight));
  const view = () => ({ content: current?.content ?? null, revision: current?.baseRevision ?? null, dirty: dirty(), status, error, copyPending: Boolean(current?.copyRequest), copyResult });
  const publish = () => { if (!closed && !signal?.aborted) onState?.(view()); };
  const report = failure => { if (!closed && !signal?.aborted) { error = failure; status = conflict(failure) ? "conflict" : "error"; publish(); } };
  const record = () => ({ draftVersion: "univer-1", artifactId, baseRevision: current.baseRevision, content: current.content,
    generation: current.generation, savedGeneration: current.savedGeneration, inflight: current.inflight, inflightGeneration: current.inflightGeneration, copyRequest: current.copyRequest || null, dirty: dirty() });
  function persist() {
    assertOpen();
    if (!current) return Promise.reject(new Error("ARTIFACT_NOT_READY"));
    // Capture before queueing. Immutable content snapshots may be shared by
    // requests; future edits replace references rather than mutate them.
    const snapshot = record();
    // The IndexedDB port reserves a key's queue synchronously. Call it now,
    // rather than defer it behind a private promise chain: a remounted editor's
    // read must see *all* writes already requested by its previous instance.
    let task;
    try { task = Promise.resolve(writeDraft(snapshot)); }
    catch (failure) { report(failure); return Promise.reject(failure); }
    return task.catch(failure => { report(failure); throw failure; });
  }
  function acceptSaved(result, body, savedGeneration) {
    if (result?.artifactId !== artifactId || result.baseRevision !== body.baseRevision || result.revision !== body.baseRevision + 1) fail("NATIVE_OFFICE_SAVE_RESULT_INVALID");
    current.baseRevision = result.revision; current.savedGeneration = savedGeneration;
    current.inflight = null; current.inflightGeneration = null;
  }
  async function recoverPending() {
    if (!current?.inflight) return;
    const body = current.inflight, generation = current.inflightGeneration;
    const result = await save(body); assertOpen();
    acceptSaved(result, body, generation); await persist(); assertOpen();
  }
  async function recoverCopy() {
    if (typeof copy !== "function") fail("ARTIFACT_REPLACEMENT_UNSUPPORTED");
    await persist(); assertOpen();
    const result = await copy(current.copyRequest); assertOpen();
    if (typeof result?.artifactId !== "string" || !result.artifactId || result.artifactId === artifactId || result.revision !== 1) fail("NATIVE_OFFICE_SAVE_RESULT_INVALID");
    // Keep the original draft and fixed copy request until the caller opens
    // the confirmed copy. If navigation/ACK is lost, the same key recovers it.
    copyResult = result; status = "copied"; error = null; publish();
    return result;
  }
  function open() {
    assertOpen();
    if (opening) return opening;
    if (current) return Promise.reject(new Error("ARTIFACT_ALREADY_OPEN"));
    opening = (async () => {
      try {
        const draft = await readDraft(); assertOpen();
        if (draft) { current = draftState(draft, artifactId); publish(); }
        if (current?.copyRequest) { await recoverCopy(); return view(); }
        // Replay before comparing cloud revision: a lost response can have
        // already advanced it. Never assign a new key to uncertain work.
        await recoverPending(); assertOpen();
        const remote = await load(); assertOpen();
        if (remote.id !== artifactId || !version(remote.revision)) fail("NATIVE_OFFICE_SAVE_RESULT_INVALID");
        const content = nativeOfficeArtifactSchema.parse(remote.content);
        if (current && dirty()) {
          if (current.content.kind !== content.kind || current.content.snapshot.id !== content.snapshot.id || current.baseRevision !== remote.revision) fail("ARTIFACT_VERSION_CONFLICT");
        } else current = { content, baseRevision: remote.revision, generation: 0, savedGeneration: 0, inflight: null, inflightGeneration: null };
        status = dirty() ? "local" : "saved"; error = null; publish();
        return view();
      } catch (failure) { report(failure); throw failure; }
    })().finally(() => { opening = null; });
    return opening;
  }
  function change(content) {
    assertOpen();
    if (!current || opening || current.copyRequest || status === "loading") fail("ARTIFACT_NOT_READY");
    const parsed = nativeOfficeArtifactSchema.parse(content);
    if (parsed.kind !== current.content.kind || parsed.snapshot.id !== current.content.snapshot.id) fail("NATIVE_OFFICE_ID_CHANGED");
    validateImportedReplacement(current.content, parsed);
    // Detached from the engine and callers; retaining an in-flight request must
    // not let a later keypress change its body under the same idempotency key.
    current.content = structuredClone(parsed); current.generation++;
    // Edits made while a save was in flight must still reach the local conflict
    // copy. Keep the conflict barrier: change() never authorizes a cloud rebase.
    if (status !== "conflict") { if (!saving) status = "local"; error = null; }
    publish();
  }
  function flush() {
    assertOpen();
    if (saving) return saving;
    if (!current || opening || current.copyRequest || ["loading", "conflict"].includes(status)) return Promise.reject(new Error("ARTIFACT_NOT_READY"));
    status = "saving"; error = null; publish();
    saving = (async () => {
      try {
        // Persist even a clean state: an earlier server ACK may have succeeded
        // while clearing its local recovery record failed.
        await persist(); assertOpen();
        while (dirty()) {
          if (!current.inflight) {
            current.inflight = { baseRevision: current.baseRevision, saveKey: requestKey(), content: current.content };
            current.inflightGeneration = current.generation;
          }
          await persist(); assertOpen();
          await recoverPending(); assertOpen();
        }
        status = "saved"; error = null; publish();
        return { revision: current.baseRevision, content: current.content };
      } catch (failure) { report(failure); throw failure; }
    })().finally(() => { saving = null; });
    return saving;
  }
  function saveConflictCopy(title) {
    assertOpen();
    if (copying) return copying;
    if (!current || opening || saving || (!current.copyRequest && status !== "conflict")) return Promise.reject(new Error("ARTIFACT_NOT_READY"));
    if (!current.copyRequest) {
      const content = structuredClone(current.content);
      content.title = typeof title === "string" ? title.trim() : "";
      if (content.kind === "sheet") content.snapshot.name = content.title;
      else content.snapshot.title = content.title;
      current.copyRequest = copyNativeOfficeArtifactSchema.parse({ content, saveKey: requestKey() });
      // A conflict is a confirmed rejection. Do not keep/replay that rejected
      // original write when recovering the independently requested copy.
      current.inflight = null; current.inflightGeneration = null;
    }
    status = "copying"; error = null; publish();
    copying = recoverCopy().catch(failure => { report(failure); throw failure; }).finally(() => { copying = null; });
    return copying;
  }
  return {
    open, change, persist, flush, saveConflictCopy,
    getState: view,
    // Caller awaits persist/flush before normal disposal. Queued local writes
    // still finish on unexpected unmount; no late network result changes state.
    dispose() { closed = true; },
  };
}
