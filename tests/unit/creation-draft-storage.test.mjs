import { afterEach, expect, it, vi } from "vitest";
import { createPendingTextJournal } from "../../src/lib/creation/client/pending-text.js";

// Minimal IndexedDB transaction port. Verifies our queue/quota decisions; actual
// browser persistence and forced-termination durability need browser tests.
function indexedDbPort() {
  const tables = { documents: new Map(), metadata: new Map() };
  const db = { transaction() {
    const staged = [], tx = { aborted: false, abort() { tx.aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore(name) {
      return {
        get(key) { const request = {}; queueMicrotask(() => { request.result = structuredClone(tables[name].get(key)); request.onsuccess?.(); }); return request; },
        getAll() { const request = {}; queueMicrotask(() => {
          request.result = structuredClone([...tables[name].values()]); request.onsuccess?.();
          queueMicrotask(() => { if (!tx.aborted) { staged.forEach(fn => fn()); tx.oncomplete?.(); } });
        }); return request; },
        put(value, key = value.key) { staged.push(() => tables[name].set(key, structuredClone(value))); },
        delete(key) { staged.push(() => tables[name].delete(key)); },
      };
    } }; return tx;
  } };
  return { tables, open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function setup() {
  const port = indexedDbPort(); vi.stubGlobal("indexedDB", port);
  const store = await import("../../src/lib/creation/client/drafts.js"); return { port, ...store };
}
const text = { pageId: "p", nodeId: "n", original: "Old", text: "Newest", composing: false };
it("makes a remount read wait for the old editor's just-enqueued text write", async () => {
  const store = await setup(); let release; const gate = new Promise(resolve => { release = resolve; });
  const journal = createPendingTextJournal({ write: (value, prepare) => store.writeArtifactTextDraft("u", "a", value, async () => { await gate; await prepare(); }), beforeClear: async () => {} });
  journal.change(text); const closing = journal.close();
  let resolved = false;
  const reopening = store.readArtifactTextDraft("u", "a").then(value => { resolved = true; return value; });
  await Promise.resolve(); await Promise.resolve(); expect(resolved).toBe(false);
  release(); await closing; expect(await reopening).toEqual(text);
  expect(await store.readArtifactTextDraft("another-user", "a")).toBeNull();
});
it("retains the old record when preparation fails and queues later reads behind that attempt", async () => {
  const store = await setup(); await store.writeArtifactTextDraft("u", "a", text);
  const failure = new Error("Operation journal unavailable");
  const writing = store.writeArtifactTextDraft("u", "a", null, async () => { throw failure; });
  const reading = store.readArtifactTextDraft("u", "a");
  await expect(writing).rejects.toBe(failure); expect(await reading).toEqual(text);
});
it("counts text and layout records as one artifact and never evicts dirty text to make room", async () => {
  const store = await setup();
  for (let index = 0; index < 10; index++) {
    await store.writeArtifactDraft("u", `a${index}`, { operations: [{ op: "pending" }] });
    await store.writeArtifactTextDraft("u", `a${index}`, text);
  }
  expect(store.port.tables.documents.size).toBe(20);
  await expect(store.writeArtifactDraft("u", "extra", { operations: [] })).rejects.toThrow("LOCAL_DRAFT_CAPACITY");
  expect(await store.readArtifactTextDraft("u", "a0")).toEqual(text);
  await store.writeArtifactDraft("u", "a0", { operations: [] }); await store.writeArtifactTextDraft("u", "a0", null);
  await store.writeArtifactDraft("u", "extra", { operations: [{ op: "pending" }] });
  expect(await store.readArtifactTextDraft("u", "a1")).toEqual(text);
  expect(await store.readArtifactDraft("u", "extra")).toEqual({ operations: [{ op: "pending" }] });
});
const scopeA = "browser-session-a-123", scopeB = "browser-session-b-123", scopeC = "browser-session-c-123";
const documentDraft = text => ({ baseRevision: 1, content: { title: text }, operations: [{ op: "setTitle", title: text }], inflight: { saveKey: "stable-save-key", operations: [{ op: "setTitle", title: text }] } });
it("isolates content and text between browser sessions and lists only matching account/artifact metadata", async () => {
  const store = await setup();
  await store.writeArtifactDraft("u", "a", documentDraft("Private A"), scopeA);
  await store.writeArtifactDraft("u", "a", documentDraft("Private B"), scopeB);
  await store.writeArtifactTextDraft("u", "a", { ...text, text: "A typing" }, undefined, scopeA);
  await store.writeArtifactTextDraft("u", "a", { ...text, text: "B typing" }, undefined, scopeB);
  await store.writeArtifactDraft("other", "a", documentDraft("Other account"), scopeA);
  await store.writeArtifactDraft("u", "another", documentDraft("Other artifact"), scopeA);
  expect((await store.readArtifactDraft("u", "a", scopeA)).content.title).toBe("Private A");
  expect((await store.readArtifactDraft("u", "a", scopeB)).content.title).toBe("Private B");
  expect((await store.readArtifactTextDraft("u", "a", scopeA)).text).toBe("A typing");
  expect((await store.readArtifactTextDraft("u", "a", scopeB)).text).toBe("B typing");
  const listing = await store.listArtifactDraftSessions("u", "a", scopeC);
  expect(listing.own).toBe(false); expect(listing.items).toHaveLength(2);
  expect(new Set(listing.items.map(item => item.sessionId))).toEqual(new Set([scopeA, scopeB]));
  expect(JSON.stringify(listing)).not.toContain("Private"); expect(JSON.stringify(listing)).not.toContain("typing");
});
it("copies an exact content/text snapshot, preserves unknown request keys, and does not take over the source", async () => {
  const store = await setup();
  await store.writeArtifactDraft("u", "a", documentDraft("Original"), scopeA); await store.writeArtifactTextDraft("u", "a", text, undefined, scopeA);
  const source = (await store.listArtifactDraftSessions("u", "a", scopeB)).items[0];
  await store.copyArtifactDraftSession("u", "a", source, scopeB);
  expect(await store.readArtifactDraft("u", "a", scopeB)).toEqual(documentDraft("Original"));
  expect(await store.readArtifactTextDraft("u", "a", scopeB)).toEqual(text);
  await store.writeArtifactDraft("u", "a", documentDraft("New source edit"), scopeA);
  expect((await store.readArtifactDraft("u", "a", scopeB)).content.title).toBe("Original");
  await store.writeArtifactTextDraft("u", "a", null, undefined, scopeB);
  expect(await store.readArtifactTextDraft("u", "a", scopeA)).toEqual(text);
  await expect(store.copyArtifactDraftSession("u", "a", (await store.listArtifactDraftSessions("u", "a", scopeB)).items[0], scopeB)).rejects.toThrow("LOCAL_DRAFT_DESTINATION_DIRTY");
});
it("detects same-millisecond source updates and aborts stale copy/removal without touching either branch", async () => {
  const store = await setup(); const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    await store.writeArtifactDraft("u", "a", documentDraft("One"), scopeA);
    const stale = (await store.listArtifactDraftSessions("u", "a", scopeB)).items[0];
    await store.writeArtifactDraft("u", "a", documentDraft("Two"), scopeA);
    await expect(store.copyArtifactDraftSession("u", "a", stale, scopeB)).rejects.toThrow("LOCAL_DRAFT_CHANGED");
    await expect(store.removeArtifactDraftSession("u", "a", stale)).rejects.toThrow("LOCAL_DRAFT_CHANGED");
    expect(await store.readArtifactDraft("u", "a", scopeB)).toBeUndefined();
    expect((await store.readArtifactDraft("u", "a", scopeA)).content.title).toBe("Two");
    const current = (await store.listArtifactDraftSessions("u", "a", scopeB)).items[0];
    await store.removeArtifactDraftSession("u", "a", current);
    expect(await store.readArtifactDraft("u", "a", scopeA)).toBeUndefined();
  } finally { now.mockRestore(); }
});
it("offers legacy drafts for explicit recovery without mutating their old keys", async () => {
  const store = await setup(); await store.writeArtifactDraft("u", "a", documentDraft("Legacy")); await store.writeArtifactTextDraft("u", "a", text);
  const source = (await store.listArtifactDraftSessions("u", "a", scopeA)).items[0]; expect(source.sessionId).toBe("legacy");
  await store.copyArtifactDraftSession("u", "a", source, scopeA);
  expect(await store.readArtifactDraft("u", "a", scopeA)).toEqual(documentDraft("Legacy"));
  expect(await store.readArtifactTextDraft("u", "a", scopeA)).toEqual(text);
  expect(await store.readArtifactDraft("u", "a")).toEqual(documentDraft("Legacy"));
});
it("aborts recovery at capacity without deleting the source or partially creating the destination", async () => {
  const store = await setup();
  for (let i = 0; i < 10; i++) await store.writeArtifactDraft("u", "a", documentDraft(String(i)), `browser-session-${i}-123`);
  const source = (await store.listArtifactDraftSessions("u", "a", scopeC)).items[0];
  await expect(store.copyArtifactDraftSession("u", "a", source, scopeC)).rejects.toThrow("LOCAL_DRAFT_CAPACITY");
  expect(await store.readArtifactDraft("u", "a", scopeC)).toBeUndefined();
  expect(await store.readArtifactDraft("u", "a", source.sessionId)).toBeTruthy(); expect(store.port.tables.documents.size).toBe(10);
});
it("keeps unconfirmed restores dirty and available for session recovery", async () => {
  const store = await setup();
  const draft = { baseRevision: 2, content: { kind: "web" }, operations: [], restoreRequest: { baseRevision: 2, restoreRevision: 1, saveKey: "web-restore-key-123" } };
  await store.writeArtifactDraft("u", "a", draft, scopeA);
  const recovery = (await store.listArtifactDraftSessions("u", "a", scopeB)).items;
  expect(recovery).toHaveLength(1); expect(recovery[0].dirty).toBe(true);
  await store.copyArtifactDraftSession("u", "a", recovery[0], scopeB);
  expect((await store.readArtifactDraft("u", "a", scopeB)).restoreRequest).toEqual(draft.restoreRequest);
});
