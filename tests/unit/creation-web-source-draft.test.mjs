import { expect, it } from "vitest";
import { pendingWebSourceSnapshot, pendingWebSourceOperations } from "../../src/lib/creation/client/pending-web-source.js";
import { createPendingTextJournal } from "../../src/lib/creation/client/pending-text.js";
const source = { kind: "web", files: [{ id: "html", path: "index.html", kind: "html", content: "<h1>Coffee</h1>" }] };
const value = { kind: "web-source", fileId: "html", path: "index.html", fileKind: "html", original: "<h1>Coffee</h1>", text: "<h1>Unfinished", composing: false };
it("retains incomplete source separately and clears it only after the operation journal barrier", async () => {
  const order = [], saved = [];
  const journal = createPendingTextJournal({ snapshot: pendingWebSourceSnapshot, write: async (data, prepare) => { await prepare(); order.push(data ? "source" : "clear"); saved.push(data); }, beforeClear: async () => { order.push("operations"); } });
  journal.change(value); await journal.flush();
  expect(saved[0]).toEqual(value); expect(saved[0]).not.toHaveProperty("files");
  journal.change(null); await journal.flush(); expect(order).toEqual(["source", "operations", "clear"]);
  expect(pendingWebSourceOperations(source, value)[0].content).toBe(value.text);
});
it("rejects changed file identity, kind, source and active composition rather than overwriting them", () => {
  expect(() => pendingWebSourceOperations(source, { ...value, composing: true })).toThrow("TEXT_COMPOSITION_ACTIVE");
  for (const changed of [{ ...value, path: "other.html" }, { ...value, fileKind: "css" }, { ...value, original: "Changed" }]) expect(() => pendingWebSourceOperations(source, changed)).toThrow("WEB_SOURCE_CHANGED");
  expect(() => pendingWebSourceSnapshot({ ...value, text: "x".repeat(512 * 1024 + 1) })).toThrow("WEB_SOURCE_DRAFT_INVALID");
  expect(pendingWebSourceOperations(source, { ...value, text: value.original })).toEqual([]);
});
