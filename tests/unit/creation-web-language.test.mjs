import { expect, it } from "vitest";
import { contentRunSchema } from "../../src/lib/creation/contracts/content-runs.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";
import { validateWebSelection } from "../../src/lib/creation/web-selection.js";

const site = () => ({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [
  { id: "html", path: "index.html", kind: "html", content: "<h1>Coffee</h1>" },
  { id: "css", path: "styles.css", kind: "css", content: "h1 { color: red }" },
  { id: "js", path: "app.js", kind: "js", content: "document.body.dataset.ready = 'yes'" },
], assetIds: [] });
const edit = () => languageInputSchema.parse({ purpose: "web.edit", prompt: "Update title", artifactId: "site", baseRevision: 1, fileIds: ["html"], paths: ["index.html"] });
it("validates requested page count and rejects invented asset IDs", () => {
  const request = contentRunSchema.parse({ kind: "web", prompt: "Coffee site", maxCredits: 1 });
  const input = languageInputSchema.parse({ purpose: "web.generate", prompt: request.prompt, pageCount: request.pageCount });
  expect(validateLanguageResult(input, site()).kind).toBe("web");
  expect(() => validateLanguageResult({ ...input, pageCount: 2 }, site())).toThrow("LANGUAGE_WEB_MISMATCH");
  expect(() => validateLanguageResult(input, { ...site(), assetIds: ["unknown"] })).toThrow("LANGUAGE_UNKNOWN_ASSET");
  expect(request.width).toBeUndefined();
});
it("requires unique matching file ID/path pairs before sending any source to a model", () => {
  const invalid = [
    { fileIds: ["html"], paths: ["styles.css"] },
    { fileIds: ["html", "css"], paths: ["styles.css", "index.html"] },
    { fileIds: ["html", "html"], paths: ["index.html", "index.html"] },
    { fileIds: ["html"], paths: [] },
    { fileIds: ["missing"], paths: ["index.html"] },
  ];
  for (const target of invalid) {
    expect(() => validateWebSelection({ ...edit(), ...target }, site())).toThrow("LANGUAGE_SELECTION_CHANGED");
    expect(() => creationLanguageMessages({ input: { ...edit(), ...target }, source: site(), assets: [] })).toThrow("LANGUAGE_SELECTION_CHANGED");
  }
  expect(() => validateWebSelection({ fileIds: ["js"], paths: ["app.js"] }, site())).toThrow("WEB_AGENT_JS_EDIT_DISABLED");
});
it("sends only selected content and checks replayed patches against the same scope", () => {
  const source = site(), input = edit();
  const payload = JSON.parse(creationLanguageMessages({ input, source, assets: [] })[1].content);
  expect(payload.source.files.map(file => file.id)).toEqual(["html"]);
  const raw = { operations: [{ op: "setFile", fileId: "html", path: "index.html", kind: "html", content: "<h1>New coffee</h1>" }] };
  const result = validateLanguageResult(input, raw, source);
  expect(validateLanguageResult(input, JSON.parse(JSON.stringify(result)), source)).toEqual(result);
  expect(source.files[0].content).toBe("<h1>Coffee</h1>");
  for (const op of [
    { op: "setFile", fileId: "css", path: "styles.css", kind: "css", content: "h1{color:blue}" },
    { op: "setTheme", theme: source.theme },
    { op: "renameFile", fileId: "html", path: "index.html", nextPath: "new.html" },
    { op: "setFile", fileId: "html", path: "index.html", kind: "js", content: "alert(1)" },
  ]) expect(() => validateLanguageResult(input, { operations: [op] }, source)).toThrow();
});
