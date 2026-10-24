import { describe, it, expect } from "vitest";
import { inspectHtml, htmlDocumentSchema, assertHtmlEditScope } from "../../src/lib/creation/html/document.js";
import { applyHtmlWithInverse } from "../../src/lib/creation/html/operations.js";
import { projectHtml } from "../../src/lib/creation/html/projection.js";
import { validateLanguageResult, languageInputSchema } from "../../src/lib/creation/contracts/language.js";
import { artworkDocumentSchema, applyArtworkOperations } from "../../src/lib/creation/artwork-codec.js";

const html = '<!DOCTYPE html><html><head><style>body{margin:0;display:grid;grid-template-columns:1fr 1fr}h1{color:#123456}</style></head><body><h1 data-node-id="title">新品上市</h1><p data-node-id="date">11月1日</p></body></html>';
const theme = { name: "Modern", primary: "#123456", accent: "#ff0000", background: "#ffffff", fontFamily: "sans" };
const document = () => htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-poster", kind: "poster", title: "新品", theme, pages: [{ id: "page", width: 1080, height: 1440, html }], metadata: { preserved: true }, extra: "keep" });
describe("HTML artwork authority", () => {
  it("keeps CSS layout and unknown metadata without object conversion", () => {
    const doc = artworkDocumentSchema.parse(document());
    expect(doc.pages[0].html).toContain("grid-template-columns"); expect(doc.extra).toBe("keep"); expect(doc.pages[0].nodes).toBeUndefined();
  });
  it("assigns stable IDs without collisions", () => {
    const first = inspectHtml('<h1 data-node-id="node_1">A</h1><p>B</p>', { assignIds: true });
    expect([...first.ids.keys()]).toEqual(["node_1", "node_2"]);
    expect(inspectHtml(first.html, { assignIds: true }).html).toBe(first.html);
  });
  it.each(['<script>alert(1)</script>', '<img src="https://example.com/x">', '<p onclick="x()">A</p>', '<iframe srcdoc="x"></iframe>', '<style>@import "https://example.com";</style><p>A</p>', '<meta http-equiv="refresh" content="0"><p>A</p>'])("rejects active markup/resources: %s", value => expect(() => inspectHtml(value)).toThrow());
  it("rejects duplicate node identities", () => expect(() => inspectHtml('<p data-node-id="x">A</p><p data-node-id="x">B</p>')).toThrow("HTML_DUPLICATE_NODE_ID"));
  it("compares outside selection including shared CSS", () => {
    expect(() => assertHtmlEditScope(html, html.replace("新品上市", "秋季新品"), ["title"])).not.toThrow();
    expect(() => assertHtmlEditScope(html, html.replace("11月1日", "11月2日"), ["title"])).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
    expect(() => assertHtmlEditScope(html, html.replace("#123456", "#ffffff"), ["title"])).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  });
  it("undoes full page edits without losing unrelated fields", () => {
    const before = document(), result = applyHtmlWithInverse(before, [{ op: "setHtmlPage", pageId: "page", html: html.replace("新品上市", "秋季新品") }]);
    expect(applyArtworkOperations(result.document, result.inverse)).toEqual(before);
  });
  it("does not reset omitted page properties on metadata edits", () => {
    const doc = document(); doc.pages[0].notes = "keep"; doc.pages[0].hidden = true;
    const next = applyArtworkOperations(doc, [{ op: "setHtmlPageMeta", pageId: "page", changes: { title: "new" } }]);
    expect(next.pages[0]).toMatchObject({ notes: "keep", hidden: true, title: "new" });
  });
  it("projection resolves assets but leaves authority unchanged", () => {
    const page = { html: '<img data-node-id="image" src="asset:asset_1234567890">' };
    const output = projectHtml(page, new Map([["asset_1234567890", "data:image/png;base64,YQ=="]]));
    expect(output.indexOf("Content-Security-Policy")).toBeLessThan(output.indexOf("<body>"));
    expect(output).toContain("script-src 'none'"); expect(output).toContain("data:image/png;base64,YQ==");
    expect(page.html).toContain("asset:asset_1234567890");
  });
  it("validates HTML generation and AI edits under the existing purposes", () => {
    const input = languageInputSchema.parse({ purpose: "poster.generate", prompt: "海报", width: 1080, height: 1440, sourceFormat: "html" });
    expect(validateLanguageResult(input, document()).schemaVersion).toBe(3);
    const edit = languageInputSchema.parse({ purpose: "poster.edit", prompt: "改标题", artifactId: "art", baseRevision: 1, pageId: "page", nodeIds: ["title"], sourceFormat: "html" });
    const result = validateLanguageResult(edit, { edited_html: html.replace("新品上市", "秋季新品") }, document());
    expect(result.operations[0].op).toBe("setHtmlPage");
    expect(() => validateLanguageResult(edit, { edited_html: html.replace("11月1日", "11月2日") }, document())).toThrow();
  });
});
