import { expect, it } from "vitest";
import { applyWithInverse } from "../../src/lib/creation/layout-history.js";
import { applyLayoutOperations } from "../../src/lib/creation/layout-operations.js";

const document = { title: "Poster", kind: "poster", pages: [{ id: "p", nodes: [
  { id: "title", type: "text", text: "Original", locked: false, x: 0, y: 0, style: { fontSize: 48, fill: "#ffffff" } },
] }] };
it("undoes a grouped text and position change in reverse order", () => {
  const edits = [{ op: "setText", pageId: "p", nodeId: "title", text: "Changed" }, { op: "setNode", pageId: "p", nodeId: "title", changes: { x: 120, y: 80 } }];
  const result = applyWithInverse(document, edits);
  expect(applyLayoutOperations(result.document, result.inverse)).toEqual(document);
  expect(document.pages[0].nodes[0].text).toBe("Original");
});
it("can undo a move that also locks the object without bypassing the lock guard", () => {
  const result = applyWithInverse(document, [{ op: "setNode", pageId: "p", nodeId: "title", changes: { x: 120, locked: true } }]);
  expect(applyLayoutOperations(result.document, result.inverse)).toEqual(document);
});
