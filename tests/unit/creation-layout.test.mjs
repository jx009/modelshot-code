import { expect, it } from "vitest";
import { layoutDocumentSchema, layoutOperationsSchema } from "../../src/lib/creation/contracts/layout.js";
import { applyLayoutOperations, inspectLayout } from "../../src/lib/creation/layout-operations.js";
import { applyWithInverse } from "../../src/lib/creation/layout-history.js";
import { alignNodeToPage, duplicateLayoutNode, nodeFrameBounds } from "../../src/lib/creation/layout-geometry.js";

function poster() {
  return layoutDocumentSchema.parse({ schemaVersion: 1, kind: "poster", title: "Coffee opening",
    theme: { name: "Coffee", primary: "#23180f", accent: "#c79b65", background: "#ffffff", fontFamily: "sans" },
    pages: [{ id: "page", title: "Poster", width: 1080, height: 1440, nodes: [
      { id: "background", name: "Background", type: "image", assetId: "original-asset", x: 0, y: 0, width: 1080, height: 1440, locked: true },
      { id: "headline", name: "Title", type: "text", text: "Coffee opens", x: 60, y: 100, width: 950, height: 120, style: { fontSize: 64 } },
      { id: "date", name: "Date", type: "text", text: "10 月 24 日", x: 60, y: 240, width: 400, height: 80, style: { fontSize: 36 } },
    ] }],
  });
}
it("edits the date and title without replacing or mutating the background", () => {
  const original = poster();
  const operations = layoutOperationsSchema.parse([
    { op: "setText", pageId: "page", nodeId: "date", text: "11 月 1 日" },
    { op: "setTextStyle", pageId: "page", nodeId: "headline", style: { fontSize: 72 } },
  ]);
  const changed = applyLayoutOperations(original, operations);
  expect(changed.pages[0].nodes[0]).toBe(original.pages[0].nodes[0]);
  expect(changed.pages[0].nodes[1].text).toBe("Coffee opens");
  expect(changed.pages[0].nodes[1].style.fontSize).toBe(72);
  expect(changed.pages[0].nodes[2].text).toBe("11 月 1 日");
  expect(original.pages[0].nodes[2].text).toBe("10 月 24 日");
  expect(layoutDocumentSchema.safeParse(changed).success).toBe(true);
});
it("does not allow an AI patch to bypass a locked image or change asset ownership fields", () => {
  expect(() => applyLayoutOperations(poster(), [{ op: "removeNode", pageId: "page", nodeId: "background" }])).toThrow("NODE_LOCKED");
  expect(layoutOperationsSchema.safeParse([{ op: "setNode", pageId: "page", nodeId: "date", changes: { userId: "attacker" } }]).success).toBe(false);
});
it("does not fill default typography properties into a partial AI edit", () => {
  const operation = layoutOperationsSchema.parse([{ op: "setTextStyle", pageId: "page", nodeId: "headline", style: { fontSize: 72 } }])[0];
  expect(operation.style).toEqual({ fontSize: 72 });
});
it("keeps page notes and identity together when slides move", () => {
  const original = poster();
  const slides = { ...original, kind: "slides", pages: [{ ...original.pages[0], notes: "First notes" }, { ...original.pages[0], id: "second", notes: "Second notes" }] };
  const changed = applyLayoutOperations(slides, [{ op: "reorderPage", pageId: "second", index: 0 }]);
  expect(changed.pages.map(page => [page.id, page.notes])).toEqual([["second", "Second notes"], ["page", "First notes"]]);
  expect(changed.pages[1]).toBe(slides.pages[0]);
});
it("rejects invalid IDs, duplicate pages and removal of the last page", () => {
  const original = poster();
  expect(() => applyLayoutOperations(original, [{ op: "setText", pageId: "page", nodeId: "missing", text: "x" }])).toThrow("NODE_NOT_FOUND");
  expect(() => applyLayoutOperations(original, [{ op: "removePage", pageId: "page" }])).toThrow("LAST_PAGE_REQUIRED");
  expect(layoutDocumentSchema.safeParse({ ...original, kind: "slides", pages: [...original.pages, ...original.pages] }).success).toBe(false);
});
it("reports overflow instead of silently clipping explicit multiline text", () => {
  const original = poster();
  const changed = applyLayoutOperations(original, [{ op: "setText", pageId: "page", nodeId: "date", text: "Line one\nLine two\nLine three" }]);
  expect(inspectLayout(changed)).toContainEqual({ code: "TEXT_HEIGHT_OVERFLOW", pageId: "page", nodeId: "date" });
});

it("aligns a rotated object frame to each page edge without changing rotation or size", () => {
  const page = { width: 1080, height: 1440 };
  for (const rotation of [0, 37, 90, -125, 180, 360]) {
    const node = { x: -230, y: 920, width: 420, height: 170, rotation };
    for (const alignment of ["left", "center", "right", "top", "middle", "bottom"]) {
      const changes = alignNodeToPage(node, page, alignment);
      const bounds = nodeFrameBounds({ ...node, ...changes });
      if (alignment === "left") expect(bounds.left).toBeCloseTo(0);
      if (alignment === "center") expect(bounds.left + bounds.width / 2).toBeCloseTo(page.width / 2);
      if (alignment === "right") expect(bounds.left + bounds.width).toBeCloseTo(page.width);
      if (alignment === "top") expect(bounds.top).toBeCloseTo(0);
      if (alignment === "middle") expect(bounds.top + bounds.height / 2).toBeCloseTo(page.height / 2);
      if (alignment === "bottom") expect(bounds.top + bounds.height).toBeCloseTo(page.height);
      expect(Object.keys(changes)).toEqual([["left", "center", "right"].includes(alignment) ? "x" : "y"]);
    }
  }
});

it("changes image fit with exact undo, preserving assets and refusing locked or non-image targets", () => {
  const original = poster();
  original.pages[0].nodes[0].locked = false;
  const operations = layoutOperationsSchema.parse([{ op: "setImageStyle", pageId: "page", nodeId: "background", changes: { fit: "contain" } }]);
  const result = applyWithInverse(original, operations);
  expect(result.document.pages[0].nodes[0]).toEqual({ ...original.pages[0].nodes[0], fit: "contain" });
  expect(result.document.pages[0].nodes[1]).toBe(original.pages[0].nodes[1]);
  expect(applyLayoutOperations(result.document, result.inverse)).toEqual(original);
  expect(() => applyLayoutOperations(poster(), operations)).toThrow("NODE_LOCKED");
  expect(() => applyLayoutOperations(original, [{ ...operations[0], nodeId: "headline" }])).toThrow("IMAGE_NODE_REQUIRED");
  expect(layoutOperationsSchema.safeParse([{ ...operations[0], changes: { fit: "cover", assetId: "other" } }]).success).toBe(false);
});

it("duplicates an object with a bounded name, new identity and independently editable styling", () => {
  const original = poster(), node = { ...original.pages[0].nodes[1], name: "x".repeat(160), x: 32768, y: 32760 };
  original.pages[0].nodes[1] = node;
  const copy = duplicateLayoutNode(node, "copy", "copy");
  const edits = layoutOperationsSchema.parse([{ op: "insertNode", pageId: "page", node: copy, index: 2 }, { op: "setTextStyle", pageId: "page", nodeId: "copy", style: { fill: "#ff0000" } }]);
  const result = applyWithInverse(original, edits);
  expect(result.document.pages[0].nodes.map(item => item.id)).toEqual(["background", "headline", "copy", "date"]);
  expect(result.document.pages[0].nodes[1]).toBe(node);
  expect(copy.name.length).toBeLessThanOrEqual(160);
  expect(layoutDocumentSchema.safeParse(result.document).success).toBe(true);
  expect(applyLayoutOperations(result.document, result.inverse)).toEqual(original);
});

it("refuses a copy at the document node limit before creating an unsavable local draft", () => {
  const original = poster();
  const document = { ...original, kind: "slides", pages: Array.from({ length: 20 }, (_, i) => ({ ...original.pages[0], id: `p${i}`, nodes: Array.from({ length: 250 }, (_, j) => ({ ...original.pages[0].nodes[1], id: `n${j}` })) })) };
  expect(layoutDocumentSchema.safeParse(document).success).toBe(true);
  expect(() => applyLayoutOperations(document, [{ op: "insertNode", pageId: "p0", node: { ...document.pages[0].nodes[0], id: "copy" } }])).toThrow("DOCUMENT_NODE_LIMIT");
  expect(() => applyLayoutOperations(document, [{ op: "insertPage", page: { ...document.pages[0], id: "copy" } }])).toThrow("DOCUMENT_NODE_LIMIT");
});
