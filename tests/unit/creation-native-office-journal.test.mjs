import { expect, it, vi } from "vitest";
import { createNativeOfficeJournal } from "../../src/lib/creation/client/native-office-journal.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
const content = value => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Costs", sheets: [{ id: "s", name: "Costs", cells: [{ id: "a", address: "A1", value }] }] }, "unit");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const data = { draft: null, remote: { id: "artifact", revision: 1, content: content(1) }, keys: new Map(), key: 0 };
  const ports = { artifactId: "artifact", readDraft: vi.fn(async () => structuredClone(data.draft)), writeDraft: vi.fn(async value => { data.draft = structuredClone(value); }), load: vi.fn(async () => structuredClone(data.remote)),
    requestKey: vi.fn(() => `native-key-123456-${++data.key}`), onState: vi.fn(),
    save: vi.fn(async body => {
      if (data.keys.has(body.saveKey)) return data.keys.get(body.saveKey);
      if (data.remote.revision !== body.baseRevision) throw Object.assign(new Error("ARTIFACT_VERSION_CONFLICT"), { code: "ARTIFACT_VERSION_CONFLICT" });
      data.remote = { id: "artifact", revision: body.baseRevision + 1, content: structuredClone(body.content) };
      const result = { artifactId: "artifact", baseRevision: body.baseRevision, revision: body.baseRevision + 1 }; data.keys.set(body.saveKey, result); return result;
    }),
  };
  return { data, ports, journal: createNativeOfficeJournal(ports) };
}

it("persists the exact request before sending and replays a lost ACK after reopening without duplicate revision", async () => {
  const { data, ports, journal } = fixture(); await journal.open(); journal.change(content(2));
  const send = ports.save.getMockImplementation();
  ports.save.mockImplementationOnce(async body => { expect(data.draft.inflight).toEqual(body); await send(body); throw new Error("connection lost"); });
  await expect(journal.flush()).rejects.toThrow("connection lost");
  const body = structuredClone(data.draft.inflight); journal.dispose();
  const reopened = createNativeOfficeJournal(ports); await reopened.open();
  expect(ports.save.mock.lastCall[0]).toEqual(body);
  expect(data.remote.revision).toBe(2); expect(ports.requestKey).toHaveBeenCalledOnce();
  expect(reopened.getState()).toMatchObject({ status: "saved", revision: 2, dirty: false });
  expect(data.draft.inflight).toBeNull();
});

it("saves a later edit after the fixed in-flight body, coalesces concurrent flushes and detaches engine objects", async () => {
  const { data, ports, journal } = fixture(); await journal.open();
  const first = content(2); journal.change(first); first.snapshot.sheets.sheet0.cellData[0][0].v = 99;
  const pause = deferred(), send = ports.save.getMockImplementation();
  ports.save.mockImplementationOnce(async body => { await pause.promise; return send(body); });
  const one = journal.flush(), two = journal.flush(); expect(one).toBe(two);
  await vi.waitFor(() => expect(ports.save).toHaveBeenCalledOnce());
  expect(ports.save.mock.calls[0][0].content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(2);
  journal.change(content(3)); await journal.persist();
  expect(data.draft.inflight.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(2);
  expect(data.draft.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(3);
  pause.resolve(); await one;
  expect(ports.save).toHaveBeenCalledTimes(2); expect(data.remote.revision).toBe(3);
  expect(data.remote.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(3);
});

it("keeps a newer local snapshot when replay confirms the preceding snapshot already saved", async () => {
  const { data, ports, journal } = fixture(); await journal.open(); journal.change(content(2));
  const pause = deferred(), send = ports.save.getMockImplementation();
  ports.save.mockImplementationOnce(async body => { await send(body); await pause.promise; throw new Error("offline"); });
  const pending = journal.flush(); const rejected = expect(pending).rejects.toThrow("offline");
  await vi.waitFor(() => expect(ports.save).toHaveBeenCalledOnce());
  journal.change(content(3)); await journal.persist(); pause.resolve(); await rejected;
  journal.dispose(); const next = createNativeOfficeJournal(ports); await next.open();
  expect(next.getState()).toMatchObject({ status: "local", revision: 2, dirty: true });
  expect(next.getState().content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(3);
  await next.flush(); expect(data.remote.revision).toBe(3);
});

it("retains local edits on version conflicts and never rebases or replaces them with the cloud snapshot", async () => {
  const { data, ports, journal } = fixture(); await journal.open(); journal.change(content(2)); await journal.persist(); journal.dispose();
  data.remote = { ...data.remote, revision: 2, content: content(9) };
  const next = createNativeOfficeJournal(ports);
  await expect(next.open()).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  expect(next.getState()).toMatchObject({ status: "conflict", revision: 1, dirty: true });
  expect(next.getState().content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(2);
  await expect(next.flush()).rejects.toThrow("ARTIFACT_NOT_READY"); expect(ports.save).not.toHaveBeenCalled();
});

it("does not send after local quota failure and retries local cleanup without duplicating a successful save", async () => {
  const { data, ports, journal } = fixture(); await journal.open(); journal.change(content(2));
  ports.writeDraft.mockRejectedValueOnce(new Error("LOCAL_DRAFT_CAPACITY"));
  await expect(journal.flush()).rejects.toThrow("LOCAL_DRAFT_CAPACITY"); expect(ports.save).not.toHaveBeenCalled();
  const persist = ports.writeDraft.getMockImplementation();
  ports.writeDraft.mockImplementation(async draft => { if (!draft.dirty && !draft.inflight) throw new Error("disk failed after ACK"); return persist(draft); });
  await expect(journal.flush()).rejects.toThrow("disk failed after ACK");
  expect(data.remote.revision).toBe(2); expect(data.draft.inflight).not.toBeNull();
  ports.writeDraft.mockImplementation(persist); await journal.flush();
  expect(ports.save).toHaveBeenCalledOnce(); expect(data.draft.dirty).toBe(false); expect(data.draft.inflight).toBeNull();
});

it("leaves the recovery body intact when closing during a save and ignores the late result", async () => {
  const { data, ports, journal } = fixture(); await journal.open(); journal.change(content(2));
  const pause = deferred(), send = ports.save.getMockImplementation();
  ports.save.mockImplementationOnce(async body => { await pause.promise; return send(body); });
  const pending = journal.flush(), rejected = expect(pending).rejects.toThrow("ARTIFACT_CLOSED");
  await vi.waitFor(() => expect(ports.save).toHaveBeenCalledOnce()); journal.dispose(); ports.onState.mockClear(); pause.resolve(); await rejected;
  expect(ports.onState).not.toHaveBeenCalled(); expect(data.draft.inflight).not.toBeNull();
  const next = createNativeOfficeJournal(ports); await next.open(); expect(next.getState().revision).toBe(2);
});

it("rejects other-format drafts, mismatched units and malformed server acknowledgements without clearing recovery", async () => {
  const bad = fixture(); bad.data.draft = { content: content(1), operations: [] };
  await expect(bad.journal.open()).rejects.toThrow("NATIVE_OFFICE_DRAFT_INVALID"); expect(bad.ports.load).not.toHaveBeenCalled();
  const { data, ports, journal } = fixture(); await journal.open();
  const different = content(2); different.snapshot.id = "different";
  expect(() => journal.change(different)).toThrow("NATIVE_OFFICE_ID_CHANGED");
  journal.change(content(2)); ports.save.mockResolvedValue({ artifactId: "other", baseRevision: 1, revision: 2 });
  await expect(journal.flush()).rejects.toThrow("NATIVE_OFFICE_SAVE_RESULT_INVALID");
  expect(data.draft.inflight).not.toBeNull(); expect(journal.getState().revision).toBe(1);
});

it("freezes a conflict copy before sending and recovers its exact key/title/content after a lost response", async () => {
  const { data, ports, journal } = fixture(); await journal.open(); journal.change(content(2)); await journal.persist();
  data.remote.revision = 2;
  await expect(journal.flush()).rejects.toThrow("ARTIFACT_VERSION_CONFLICT"); journal.dispose();
  const copy = vi.fn().mockRejectedValueOnce(new Error("copy ACK lost")).mockResolvedValue({ artifactId: "copy", revision: 1, baseRevision: 0 });
  const current = createNativeOfficeJournal({ ...ports, copy });
  await expect(current.open()).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  await expect(current.saveConflictCopy("Recovered copy")).rejects.toThrow("copy ACK lost");
  const fixed = structuredClone(data.draft.copyRequest);
  expect(fixed.content.title).toBe("Recovered copy"); expect(fixed.content.snapshot.name).toBe("Recovered copy");
  expect(data.draft.inflight).toBeNull(); expect(data.remote.content.title).toBe("Costs");
  expect(() => current.change(content(3))).toThrow("ARTIFACT_NOT_READY");
  current.dispose(); const restored = createNativeOfficeJournal({ ...ports, copy });
  await restored.open();
  expect(copy.mock.lastCall[0]).toEqual(fixed);
  expect(restored.getState()).toMatchObject({ status: "copied", copyResult: { artifactId: "copy", revision: 1 } });
  expect(data.draft.copyRequest).toEqual(fixed); expect(data.remote.revision).toBe(2);
});

it("does not create a conflict copy before local persistence or while the original save outcome is unknown", async () => {
  const { data, ports, journal } = fixture(); await journal.open(); journal.change(content(2));
  ports.save.mockRejectedValueOnce(new Error("offline")); await expect(journal.flush()).rejects.toThrow("offline");
  await expect(journal.saveConflictCopy("Copy")).rejects.toThrow("ARTIFACT_NOT_READY");
  data.remote.revision = 2;
  await expect(journal.flush()).rejects.toThrow("ARTIFACT_VERSION_CONFLICT"); journal.dispose();
  const copy = vi.fn(), next = createNativeOfficeJournal({ ...ports, copy });
  await expect(next.open()).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  ports.writeDraft.mockRejectedValueOnce(new Error("disk full"));
  await expect(next.saveConflictCopy("Copy")).rejects.toThrow("disk full"); expect(copy).not.toHaveBeenCalled();
});
