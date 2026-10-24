import { expect, it } from "vitest";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { applyWebOperations, applyWebOperationsWithInverse } from "../../src/lib/creation/web-operations.js";
import { suggestedWebPath, validateNewWebPath, webFileAction } from "../../src/lib/creation/client/web-files.js";
const site = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [{ id: "html", path: "index.html", kind: "html", content: "<h1>Coffee</h1>" }, { id: "css", path: "styles.css", kind: "css", content: "h1 { color:red }" }, { id: "about", path: "about.html", kind: "html", content: "<h1>About</h1>" }] });
it("undoes a mixed file batch exactly, including order, paths, entry, theme and successive contents", () => {
  const source = site(), original = structuredClone(source);
  const result = applyWebOperationsWithInverse(source, [
    { op: "setFile", fileId: "html", path: "index.html", kind: "html", content: "<h1>First</h1>" },
    { op: "setFile", fileId: "html", path: "index.html", kind: "html", content: "<h1>Second</h1>" },
    { op: "setEntry", path: "about.html" },
    { op: "removeFile", fileId: "css", path: "styles.css" },
    { op: "renameFile", fileId: "about", path: "about.html", nextPath: "pages/about.html" },
    { op: "insertFile", file: { id: "script", path: "app.js", kind: "js", content: "/* test */" }, index: 1 },
    { op: "setTheme", theme: { ...source.theme, primary: "#ff0000" } },
  ]);
  expect(result.document.entryPath).toBe("pages/about.html");
  expect(result.document.files.map(file => file.id)).toEqual(["html", "script", "about"]);
  const undo = applyWebOperationsWithInverse(result.document, result.inverse);
  expect(undo.document).toEqual(original); expect(source).toEqual(original);
  expect(applyWebOperations(undo.document, undo.inverse)).toEqual(result.document);
});
it("restores asset registration exactly when inserting, sharing and removing resource files", () => {
  const source = site(); source.assetIds = ["unused-reference"];
  const result = applyWebOperationsWithInverse(source, [
    { op: "insertFile", file: { id: "one", path: "one.webp", kind: "asset", assetId: "photo" } },
    { op: "insertFile", file: { id: "two", path: "two.webp", kind: "asset", assetId: "photo" } },
  ]);
  expect(result.document.assetIds).toEqual(["unused-reference", "photo"]);
  expect(applyWebOperations(result.document, result.inverse)).toEqual(source);
  const removed = applyWebOperationsWithInverse(result.document, [{ op: "removeFile", fileId: "one", path: "one.webp" }]);
  expect(removed.document.assetIds).toEqual(result.document.assetIds);
  expect(applyWebOperations(removed.document, removed.inverse)).toEqual(result.document);
  expect(() => applyWebOperations(result.document, [{ op: "setAssetIds", assetIds: [] }])).toThrow();
});
it("rejects stale targets, occupied paths, invalid positions and deletion of the entry without mutating the source", () => {
  const source = site(), original = structuredClone(source);
  for (const operation of [
    { op: "removeFile", fileId: "html", path: "index.html" },
    { op: "renameFile", fileId: "css", path: "old.css", nextPath: "new.css" },
    { op: "renameFile", fileId: "css", path: "styles.css", nextPath: "about.html" },
    { op: "insertFile", file: { id: "new", path: "new.css", kind: "css", content: "/* css */" }, index: 100 },
  ]) expect(() => applyWebOperationsWithInverse(source, [operation])).toThrow();
  expect(source).toEqual(original);
});
it("creates text files, copies the latest content, and preserves source files", () => {
  const content = site();
  const request = { action: "create", newId: "new", nextPath: "pages/contact.html", kind: "html", zh: false };
  const action = webFileAction(content, request), next = applyWebOperations(content, action.operations);
  expect(next.files.at(-1).content).toContain('<html lang="en">'); expect(next.files.at(-1).content).toContain("New page");
  content.files[1].content = "/* Latest draft */";
  const copied = webFileAction(content, { action: "duplicate", fileId: "css", path: "styles.css", nextPath: "styles-copy.css", newId: "copy" });
  expect(copied.operations[0].file.content).toBe("/* Latest draft */"); expect(content.files).toHaveLength(3);
  expect(webFileAction(content, { action: "entry", fileId: "about", path: "about.html" }).operations).toEqual([{ op: "setEntry", path: "about.html" }]);
});
it("rejects nonportable paths, extension mismatches and directory collisions before file creation", () => {
  const content = site(); content.files.push({ id: "nested", path: "Assets/main.css", kind: "css", content: "/* css */" });
  for (const path of ["INDEX.HTML", "../page.html", "page.html.", "con.html", "index.html/child.html", "Assets/main.css/test.html", "assets/new.html", "other.css", "https://x/page.html"]) expect(() => validateNewWebPath(content, path, "html")).toThrow();
  expect(validateNewWebPath(content, "Assets/new.html", "html")).toBe("Assets/new.html");
  expect(suggestedWebPath(content, content.files[1])).toBe("styles-copy.css");
  content.files.push({ id: "copy", path: "STYLES-COPY.css", kind: "css", content: "/* css */" });
  expect(suggestedWebPath(content, content.files[1])).toBe("styles-copy-2.css");
});
it("enforces page and undo limits without affecting ordinary server operation application", () => {
  const content = site();
  for (let index = 0; index < 18; index++) content.files.push({ id: `p${index}`, path: `p${index}.html`, kind: "html", content: "<p>x</p>" });
  expect(() => webFileAction(content, { action: "create", kind: "html", newId: "new", nextPath: "new.html" })).toThrow("WEB_SITE_TOO_LARGE");
  const insertions = Array.from({ length: 51 }, (_, index) => ({ op: "insertFile", file: { id: `a${index}`, path: `a${index}.webp`, kind: "asset", assetId: `photo${index}` } }));
  expect(() => applyWebOperationsWithInverse(site(), insertions)).toThrow("WEB_UNDO_BATCH_TOO_LARGE");
  expect(applyWebOperations(site(), insertions).files).toHaveLength(54);
});
