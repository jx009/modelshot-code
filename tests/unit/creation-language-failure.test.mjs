import { expect, it } from "vitest";
import { AppError } from "../../src/lib/http.js";
import { languageFailure, languageFailureDiagnostic } from "../../src/lib/creation/language-failure.js";
import { parseLanguageJson } from "../../src/lib/creation/language-json.js";
import { validateHtmlLanguageResult } from "../../src/lib/creation/html/language.js";
import { inspectHtml, HtmlDocumentError } from "../../src/lib/creation/html/document.js";

const input = { purpose: "slides.page", pageId: "page", width: 1280, height: 720, assetIds: [] };
const page = html => ({ id: "page", width: 1280, height: 720, html });

it("preserves application errors despite Error.name and distinguishes provider failures", () => {
  expect(new AppError("LANGUAGE_TIMEOUT", 504).name).toBe("Error");
  for (const code of ["LANGUAGE_TIMEOUT", "LANGUAGE_RESULT_INCOMPLETE", "CREATION_REFERENCE_ARCHIVE_INVALID"]) {
    expect(languageFailure(new AppError(code, 502))).toBe(code);
    expect(languageFailureDiagnostic(new AppError(code, 502)).errorCode).toBe(code);
  }
  expect(languageFailure(new HtmlDocumentError("HTML_UNSAFE_STYLE"))).toBe("HTML_UNSAFE_STYLE");
  for (const [error, code] of [
    [{ status: 429 }, "LANGUAGE_PROVIDER_RATE_LIMITED"], [{ status: 401 }, "LANGUAGE_PROVIDER_AUTH_FAILED"],
    [{ status: 503 }, "LANGUAGE_PROVIDER_UNAVAILABLE"], [{ status: 400 }, "LANGUAGE_PROVIDER_REQUEST_REJECTED"],
    [{ name: "APIConnectionTimeoutError" }, "LANGUAGE_TIMEOUT"], [{ code: "ECONNRESET" }, "LANGUAGE_PROVIDER_CONNECTION_FAILED"],
  ]) expect(languageFailure(error)).toBe(code);
});

it("logs bounded validation locations without model content, credentials or arbitrary field names", () => {
  const error = { name: "ZodError", message: "SECRET", issues: Array.from({ length: 9 }, () => ({ code: "custom", path: ["pages", 0, "SECRET", "html"], message: "HTML_UNSAFE_STYLE" })) };
  const diagnostic = languageFailureDiagnostic(error);
  expect(diagnostic.errorCode).toBe("HTML_UNSAFE_STYLE");
  expect(diagnostic.issues).toHaveLength(5);
  expect(JSON.stringify(diagnostic)).not.toContain("SECRET");
});

it("accepts an exact JSON fence but refuses truncated JSON, prose and non-object responses", () => {
  expect(parseLanguageJson('```json\n{"id":"page"}\n```')).toEqual({ id: "page" });
  expect(parseLanguageJson('{"id":"page"}')).toEqual({ id: "page" });
  for (const invalid of ['Here is the result: {"id":"page"}', '{"id":', 'null', '[]', '```json\n{}\n``` explanation']) expect(() => parseLanguageJson(invalid)).toThrow();
});

it("normalizes generated CSS comments and duplicate IDs while keeping direct inspection strict", () => {
  const html = '<style>/* layout */h1{color:#111}</style><h1 data-node-id="same">Title</h1><p data-node-id="same" style="/* gap */margin:0">Body</p>';
  expect(() => inspectHtml(html)).toThrow();
  const result = validateHtmlLanguageResult(input, page(html));
  const parsed = inspectHtml(result.html);
  expect(parsed.ids.size).toBe(2);
  expect(parsed.ids.has("same")).toBe(true);
  expect(result.html).not.toContain("/*");
  expect(validateHtmlLanguageResult(input, result)).toEqual(result);
});

it.each([
  '<script>alert(1)</script><h1>Title</h1>', '<h1 onclick="alert(1)">Title</h1>',
  '<style>/* ok */@import "https://bad.test/a.css";</style><h1>Title</h1>',
  '<style>h1{background:/* ok */url(https://bad.test/a.png)}</style><h1>Title</h1>',
  '<style>h1{width:/* ok */expression(alert(1))}</style><h1>Title</h1>',
  '<style>/* never closed</style><h1>Title</h1>', '<img src="asset:foreign">',
])("does not relax resource ownership or safety validation for generated HTML: %s", html => {
  expect(() => validateHtmlLanguageResult(input, page(html))).toThrow();
});

it("does not normalize edit results or allow a comment to change content outside the selection", () => {
  const html = '<h1 data-node-id="title">Original</h1><p data-node-id="body">Keep</p>';
  const source = { schemaVersion: 3, format: "html-slides", pages: [page(html)] };
  expect(() => validateHtmlLanguageResult({ ...input, purpose: "slides.edit", nodeIds: ["title"] }, { edited_html: html.replace('Original', 'Changed').replace('Keep', 'Altered') }, source)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
});
