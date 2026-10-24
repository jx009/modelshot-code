import { afterEach, expect, it, vi } from "vitest";
import { createPendingTextJournal, pendingTextSnapshot, pendingTextOperations } from "../../src/lib/creation/client/pending-text.js";

const draft = { pageId: "page", nodeId: "title", original: "Original", text: "中文", composing: false };
afterEach(() => vi.useRealTimers());
it("coalesces typing into small records without saving a full layout and enforces a maximum wait", async () => {
  vi.useFakeTimers(); const write = vi.fn(async (_value, prepare) => prepare()), beforeClear = vi.fn();
  const journal = createPendingTextJournal({ write, beforeClear });
  for (let i = 0; i < 10; i++) { journal.change({ ...draft, text: String(i), node: { large: "unused" } }); await vi.advanceTimersByTimeAsync(100); }
  expect(write).toHaveBeenCalledOnce(); expect(write.mock.calls[0][0]).toEqual({ ...draft, text: "9" });
  expect(beforeClear).not.toHaveBeenCalled(); expect(journal.dirty()).toBe(false);
  journal.change({ ...draft, text: "latest" }); await journal.close();
  expect(write).toHaveBeenLastCalledWith({ ...draft, text: "latest" }, expect.any(Function));
});
it("never clears the recovery record before the operation journal is durable, and retries storage failures", async () => {
  vi.useFakeTimers(); const order = [], failure = new Error("Quota"), beforeClear = vi.fn(async () => { order.push("operations"); throw failure; });
  const write = vi.fn(async (value, prepare) => { await prepare(); order.push(value === null ? "clear" : "text"); });
  const journal = createPendingTextJournal({ write, beforeClear });
  journal.change(draft); await journal.flush(); journal.change(null);
  await expect(journal.flush()).rejects.toBe(failure); expect(order).toEqual(["text", "operations"]); expect(journal.dirty()).toBe(true);
  beforeClear.mockImplementation(async () => { order.push("operations"); });
  await journal.flush(); expect(order).toEqual(["text", "operations", "operations", "clear"]); expect(journal.dirty()).toBe(false);
});
it("serializes clear and later typing without losing the newest record or duplicating active writes", async () => {
  vi.useFakeTimers(); let release; const gate = new Promise(resolve => { release = resolve; });
  const stored = [], write = vi.fn(async (value, prepare) => { await prepare(); stored.push(value); }), journal = createPendingTextJournal({ write, beforeClear: () => gate });
  journal.change(null); const clearing = journal.flush(); expect(journal.flush()).toBe(clearing);
  journal.change(draft); const typing = journal.flush();
  expect(write).toHaveBeenCalledTimes(2); // Storage queue slots are reserved synchronously.
  await Promise.resolve(); expect(stored).toEqual([]); release(); await typing;
  expect(stored).toEqual([null, draft]); expect(journal.snapshot()).toEqual(draft); expect(journal.dirty()).toBe(false);
});
it("retains composition text as data and does not rewrite an untouched recovered draft", async () => {
  vi.useFakeTimers(); const write = vi.fn(async (_value, prepare) => prepare()), journal = createPendingTextJournal({ write, beforeClear: vi.fn() });
  journal.seed({ ...draft, composing: true }); await journal.close(); expect(write).not.toHaveBeenCalled(); expect(journal.snapshot().composing).toBe(true);
  journal.change({ ...draft, text: "zhong", composing: true }); await journal.flush(); expect(write).toHaveBeenCalledWith({ ...draft, text: "zhong", composing: true }, expect.any(Function));
});
it("only restores the exact original text target and handles already committed text without duplication", () => {
  const content = { pages: [{ id: "page", nodes: [{ id: "title", type: "text", text: "Original" }] }] };
  expect(pendingTextOperations(content, draft)).toEqual([{ op: "setText", pageId: "page", nodeId: "title", text: "中文" }]);
  content.pages[0].nodes[0].text = "中文"; expect(pendingTextOperations(content, draft)).toEqual([]);
  content.pages[0].nodes[0].text = "Newer"; expect(() => pendingTextOperations(content, draft)).toThrow("TEXT_EDIT_TARGET_CHANGED");
  content.pages[0].nodes[0].text = "Original"; content.pages[0].nodes[0].locked = true;
  expect(() => pendingTextOperations(content, draft)).toThrow("NODE_LOCKED");
  expect(() => pendingTextOperations({ pages: [] }, draft)).toThrow("TEXT_EDIT_TARGET_CHANGED");
});
it("bounds recovery records and never persists geometry, assets or arbitrary object fields", () => {
  expect(pendingTextSnapshot({ ...draft, content: { secret: "unused" } })).toEqual(draft);
  expect(() => pendingTextSnapshot({ ...draft, text: "x".repeat(16001) })).toThrow("TEXT_DRAFT_INVALID");
  expect(() => pendingTextSnapshot({ ...draft, nodeId: "../other" })).toThrow("TEXT_DRAFT_INVALID");
});
