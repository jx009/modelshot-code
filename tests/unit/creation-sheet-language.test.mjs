import { expect, it } from "vitest";
import { contentRunSchema } from "../../src/lib/creation/contracts/content-runs.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";

const generated = { schemaVersion: 1, kind: "sheet", title: "Sales", locale: "en", sheets: [{ id: "sales", name: "Sales", cells: [{ id: "a1", address: "A1", value: "Amount" }, { id: "a2", address: "A2", value: 10 }, { id: "a3", address: "A3", value: 20 }, { id: "a4", address: "A4", formula: "=SUM(A2:A3)" }] }] };
it("accepts sheet generation requests without image dimensions and validates bounded native workbook results", () => {
  const input = contentRunSchema.parse({ kind: "sheet", prompt: "Make a sales workbook", maxCredits: 10, sheetCount: 1, targetRows: 20 });
  const language = languageInputSchema.parse({ prompt: input.prompt, locale: input.locale, assetIds: input.assetIds, purpose: "sheet.generate", sheetCount: input.sheetCount, targetRows: input.targetRows });
  expect(language.purpose).toBe("sheet.generate"); expect(language.width).toBeUndefined(); expect(validateLanguageResult(language, generated).sheets[0].cells).toHaveLength(4);
});
it("limits sheet AI edits to the exact selected addresses and keeps formulas/data separate", () => {
  const source = generated, input = languageInputSchema.parse({ prompt: "Fix total", locale: "en", assetIds: [], purpose: "sheet.edit", artifactId: "artifact", baseRevision: 1, sheetId: "sales", addresses: ["A2"] });
  const result = validateLanguageResult(input, { operations: [{ op: "setCell", sheetId: "sales", address: "A2", id: "a2", value: 15, expectedValue: 10 }] }, source);
  expect(result.operations).toHaveLength(1);
  expect(validateLanguageResult(input, JSON.parse(JSON.stringify(result)), source)).toEqual(result);
  expect(() => validateLanguageResult(input, { operations: [{ op: "setCell", sheetId: "sales", address: "A3", id: "a3", value: 15 }] }, source)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(() => validateLanguageResult(input, { operations: [{ op: "setCell", sheetId: "sales", address: "A2", id: "a2", value: 15, formula: "=SUM(A2:A3)" }] }, source)).toThrow();
});
it("sends only selected cells, accepts selected blanks and rejects duplicate selections before invoking models", () => {
  const input = languageInputSchema.parse({ purpose: "sheet.edit", prompt: "Fill blanks", artifactId: "artifact", baseRevision: 1, sheetId: "sales", addresses: ["A2", "B2"] });
  const message = JSON.parse(creationLanguageMessages({ input, source: generated, assets: [] })[1].content);
  expect(message.source.sheet.cells.map(cell => cell.address)).toEqual(["A2"]);
  expect(message.source.sheets).toBeUndefined();
  expect(validateLanguageResult(input, { operations: [{ op: "setCell", sheetId: "sales", address: "B2", id: "b2", value: 20 }] }, generated).operations).toHaveLength(1);
  expect(languageInputSchema.safeParse({ ...input, addresses: ["A2", "A2"] }).success).toBe(false);
  expect(() => creationLanguageMessages({ input: { ...input, sheetId: "missing" }, source: generated, assets: [] })).toThrow("LANGUAGE_SELECTION_CHANGED");
});
it("bounds generation by actual row/column coordinates and rejects unsupported giant one-shot requests", () => {
  const input = languageInputSchema.parse({ purpose: "sheet.generate", prompt: "Budget", sheetCount: 1, targetRows: 20 });
  const result = { ...generated, sheets: [{ ...generated.sheets[0], cells: [{ id: "outside", address: "A21", value: 2 }] }] };
  expect(() => validateLanguageResult(input, result)).toThrow("LANGUAGE_SHEET_MISMATCH");
  expect(contentRunSchema.safeParse({ kind: "sheet", prompt: "Large", maxCredits: 10, targetRows: 100000 }).success).toBe(false);
});
it("does not give the spreadsheet prompt arbitrary scripts, macros, external connections, or hidden source instructions", () => {
  const input = languageInputSchema.parse({ prompt: "Create a budget", locale: "en", assetIds: [], purpose: "sheet.generate", sheetCount: 1, targetRows: 10 });
  const system = creationLanguageMessages({ input, source: null, assets: [], images: [] })[0].content;
  expect(system).toContain("Never output scripts"); expect(system).toContain("external data connections"); expect(system).toContain("macros"); expect(system).toContain("SUM, AVERAGE");
});
