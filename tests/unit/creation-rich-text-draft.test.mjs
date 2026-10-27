import { expect, it } from "vitest";
import { pendingTextOperations } from "../../src/lib/creation/client/pending-text.js";
import { inspectHtml, htmlAssetIds } from "../../src/lib/creation/html/document.js";
import { applyHtmlWithInverse } from "../../src/lib/creation/html/operations.js";

const original = '<h1 data-node-id="title" style="color: red">Hello <strong data-node-id="emphasis">world</strong></h1>';
const text = '<h1 data-node-id="title" style="color: red">Hello <span style="font-weight: 700">中文</span></h1>';
const draft = { format: "html-text", pageId: "page", nodeId: "title", original, text };
const content = () => ({ schemaVersion: 3, kind: "slides", pages: [{ id: "page", html: inspectHtml(original + '<img data-node-id="photo" src="asset:photo"><p data-node-id="other">Latest neighbour</p>').html }] });

it("recovers only the rich text object, preserving neighbouring content and original asset references", () => {
  const before = content(), operations = pendingTextOperations(before, draft);
  const { document, inverse } = applyHtmlWithInverse(before, operations);
  expect(document.pages[0].html).toContain('src="asset:photo"');
  expect(document.pages[0].html).toContain('data-node-id="other">Latest neighbour');
  expect(document.pages[0].html).toContain('style="color: red"');
  expect(document.pages[0].html).toContain("中文");
  expect(applyHtmlWithInverse(document, inverse).document).toEqual(before);
  // Range formatting regenerated child IDs; a repeated recovery remains a no-op.
  expect(pendingTextOperations(document, draft)).toEqual([]);
});
it("refuses to overwrite a newer change to the edited object", () => {
  const changed = content(); changed.pages[0].html = changed.pages[0].html.replace("world", "newer");
  expect(() => pendingTextOperations(changed, draft)).toThrow("TEXT_EDIT_TARGET_CHANGED");
});
it.each([
  '<h1 data-node-id="title"><img src="asset:photo"></h1>',
  '<h1 data-node-id="title"><script>alert(1)</script></h1>',
  '<h1 data-node-id="title">new</h1><p>unexpected sibling</p>',
  '<h1 data-node-id="title"><span onclick="alert(1)">new</span></h1>',
])("rejects media, unsafe markup and extra roots in a text draft: %s", text => {
  expect(() => pendingTextOperations(content(), { ...draft, text })).toThrow();
});
it("keeps the parsing context when editing a table cell", () => {
  const original = '<td data-node-id="cell">Before</td>', text = '<td data-node-id="cell"><b>After</b></td>';
  const before = { schemaVersion: 3, kind: "slides", pages: [{ id: "page", html: '<table><tbody><tr>' + original + '</tr></tbody></table>' }] };
  const recovery = { ...draft, nodeId: "cell", original, text };
  const after = applyHtmlWithInverse(before, pendingTextOperations(before, recovery)).document;
  expect(after.pages[0].html).toContain('data-node-id="cell"');
  expect(after.pages[0].html).toContain("After");
  expect(pendingTextOperations(after, recovery)).toEqual([]);
});
it("allows deleting the final slide object, scanning its assets, and undoing the deletion", () => {
  const before = content(), operations = [{ op: "setHtmlPage", pageId: "page", html: "<html><body></body></html>" }];
  const after = applyHtmlWithInverse(before, operations);
  expect(htmlAssetIds(after.document)).toEqual([]);
  expect(applyHtmlWithInverse(after.document, after.inverse).document).toEqual(before);
  expect(() => applyHtmlWithInverse({ ...before, kind: "poster" }, operations)).toThrow("HTML_EMPTY_DOCUMENT");
});
