import { expect, it } from "vitest";
import { assertNativeOfficeRuntimeContent } from "../../src/lib/creation/client/native-office-policy.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { readFileSync } from "node:fs";

const workbook = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Sheet", cells: [] }] }, "unit");
it("reopens a real browser-saved document without dropping its preset metadata", () => {
  const content = JSON.parse(readFileSync(new URL("../fixtures/creation-native-document-browser.json", import.meta.url), "utf8"));
  expect(assertNativeOfficeRuntimeContent(content)).toEqual(content);
  const permission = content.snapshot.resources.find(resource => resource.name === "DOC_OBJECT_PERMISSION_PLUGIN");
  for (const data of ['[{"objectId":"p0","permissionId":"private","objectType":3}]', '{}', '', 'invalid']) {
    permission.data = data;
    expect(() => assertNativeOfficeRuntimeContent(content)).toThrow("NATIVE_OFFICE_RESOURCE_UNSUPPORTED");
    expect(permission.data).toBe(data);
  }
});
it("reopens a real browser-saved workbook but refuses populated authorization metadata", () => {
  const content = JSON.parse(readFileSync(new URL("../fixtures/creation-native-sheet-browser.json", import.meta.url), "utf8"));
  expect(assertNativeOfficeRuntimeContent(content)).toEqual(content);
  const authorization = content.snapshot.resources.find(resource => resource.name === "SHEET_AuthzIoMockService_PLUGIN");
  for (const data of ['{"private":true}', '[]', '', 'invalid']) {
    authorization.data = data;
    expect(() => assertNativeOfficeRuntimeContent(content)).toThrow("NATIVE_OFFICE_RESOURCE_UNSUPPORTED");
    expect(authorization.data).toBe(data);
  }
});
it("keeps supported native data intact and refuses unknown resources instead of stripping them", () => {
  const data = workbook(); data.snapshot.resources.push({ name: "SHEET_DEFINED_NAME_PLUGIN", data: "{}" });
  data.snapshot.custom.extra = "retained";
  expect(assertNativeOfficeRuntimeContent(data)).toEqual(data);
  data.snapshot.resources.push({ name: "UNKNOWN_PLUGIN", data: "keep me" });
  expect(() => assertNativeOfficeRuntimeContent(data)).toThrow("NATIVE_OFFICE_RESOURCE_UNSUPPORTED");
  expect(data.snapshot.resources.at(-1).data).toBe("keep me");
});
it("rejects runtime media and external formulas without treating ordinary text as executable data", () => {
  const data = workbook(); data.snapshot.sheets.sheet0.cellData = { 0: { 0: { t: 1, v: '=HYPERLINK("https://example.test")' } } };
  expect(() => assertNativeOfficeRuntimeContent(data)).not.toThrow();
  data.snapshot.sheets.sheet0.cellData[0][0] = { f: '=HYPERLINK("https://example.test")' };
  expect(() => assertNativeOfficeRuntimeContent(data)).toThrow("NATIVE_OFFICE_FORMULA_UNSUPPORTED");
  data.snapshot.sheets.sheet0.cellData = {}; data.snapshot.drawings = { image: { src: "https://example.test" } };
  expect(() => assertNativeOfficeRuntimeContent(data)).toThrow("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
});
it("bounds the runtime grid separately from sparse storage and detects nested invalid resource JSON", () => {
  const data = workbook(); data.snapshot.sheets.sheet0.rowCount = 1048576;
  expect(() => assertNativeOfficeRuntimeContent(data)).toThrow("NATIVE_OFFICE_RUNTIME_LIMIT");
  data.snapshot.sheets.sheet0.rowCount = 200;
  data.snapshot.resources = [{ name: "SHEET_DEFINED_NAME_PLUGIN", data: '{"__proto__":{}}' }];
  expect(() => assertNativeOfficeRuntimeContent(data)).toThrow("NATIVE_OFFICE_RESOURCE_UNSUPPORTED");
});
