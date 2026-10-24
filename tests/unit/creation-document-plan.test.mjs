import { expect, it } from "vitest";
import { contentRunSchema } from "../../src/lib/creation/contracts/content-runs.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { confirmOutlineSchema } from "../../src/lib/creation/contracts/outline-review.js";
import { outlineChildren } from "../../src/lib/creation/outline-plan.js";
import { assembleDocumentContent } from "../../src/lib/domain/creation/document-assembly.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";
import { textDocumentSchema } from "../../src/lib/creation/contracts/document.js";

const outline = () => ({ title: "Report", sections: [{ id: "summary", title: "Summary", brief: "Summary facts" }, { id: "details", title: "Details", brief: "Detail facts" }] });
const run = () => ({ id: "run", kind: "document", input: { sectionCount: 2 }, steps: [{ params: { purpose: "document.outline", prompt: "Write a report", sectionCount: 2, locale: "en", audience: "Investors", assetIds: [] } }] });
const section = item => ({ id: item.id, title: item.title, blocks: [{ id: "same-p", type: "paragraph", runs: [{ text: item.title }] }] });

it("accepts document-specific requests and rejects irrelevant image dimensions and ambiguous outline payloads", () => {
  const input = { kind: "document", prompt: "Report", sectionCount: 2, maxCredits: 6 };
  expect(contentRunSchema.parse(input)).toMatchObject({ kind: "document", sectionCount: 2 });
  expect(contentRunSchema.safeParse({ ...input, width: 1080, height: 1440 }).success).toBe(false);
  const approval = { saveKey: "approve-key-123456", expectedSequence: 3, expectedUnitCost: 2, maxCredits: 6, outline: outline() };
  expect(confirmOutlineSchema.parse(approval).outline.sections).toHaveLength(2);
  expect(confirmOutlineSchema.safeParse({ ...approval, outline: { ...outline(), pages: [] } }).success).toBe(false);
  expect(() => validateLanguageResult(languageInputSchema.parse({ purpose: "document.outline", prompt: "Report", sectionCount: 3 }), outline())).toThrow("LANGUAGE_OUTLINE_MISMATCH");
});

it("expands exactly the reviewed order with one runnable section and only heading metadata from other sections", () => {
  const approved = outline(); approved.sections.reverse();
  const steps = outlineChildren(run(), approved, 2);
  expect(steps.map(step => [step.tool, step.status, step.params.sectionId])).toEqual([["document.section", "ready", "details"], ["document.section", "blocked", "summary"]]);
  expect(steps[0].params).toMatchObject({ documentTitle: "Report", title: "Details", brief: "Detail facts", headings: [{ id: "details", title: "Details" }, { id: "summary", title: "Summary" }] });
  expect(JSON.stringify(steps[0].params)).not.toContain("Summary facts");
  expect(steps.every(step => step.expectedCost === 2)).toBe(true);
  const result = validateLanguageResult(steps[0].params, section(approved.sections[0]));
  expect(result.id).toBe("details");
});

it("preserves selected references in child steps and accepts older outlines without referenceIds", () => {
  expect(outlineChildren(run(), outline(), 2).every(step => step.params.referenceIds.length === 0)).toBe(true);
  const withFiles = run(); withFiles.steps[0].params.referenceIds = ["brief"];
  expect(outlineChildren(withFiles, outline(), 2).map(step => step.params.referenceIds)).toEqual([["brief"], ["brief"]]);
});

it("namespaces repeated generated block/cell IDs deterministically and preserves source assets and approved order", () => {
  const approved = outline(), parts = approved.sections.map(section);
  parts[1].blocks.push({ id: "table", type: "table", headerRows: 1, rows: [{ id: "row", cells: [{ id: "cell", runs: [{ text: "18" }] }] }] });
  parts[0].blocks.push({ id: "image", type: "image", assetId: "asset", width: 100, height: 100 });
  const content = assembleDocumentContent(approved, parts, "en"), again = assembleDocumentContent(approved, parts, "en");
  expect(content).toEqual(again);
  expect(content.sections.map(part => part.id)).toEqual(["summary", "details"]);
  expect(content.sections[0].blocks[0].id).not.toBe(content.sections[1].blocks[0].id);
  expect(content.sections[0].blocks[1].assetId).toBe("asset");
  expect(parts[0].blocks[0].id).toBe("same-p");
  expect(() => assembleDocumentContent(approved, parts.toReversed(), "en")).toThrow("CREATION_OUTLINE_CHANGED");
});

it("refuses a whole document above the aggregate text budget even if individual sections are valid", () => {
  const approved = outline(), parts = approved.sections.map(item => ({ ...section(item), blocks: Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, type: "paragraph", runs: [{ text: "a".repeat(16000) }] })) }));
  expect(() => assembleDocumentContent(approved, parts, "en")).toThrow("DOCUMENT_CONTENT_LIMIT");
});

it("sends only selected blocks to the document provider and rejects stale text ranges before producing prompts", () => {
  const source = textDocumentSchema.parse({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Summary", blocks: [{ id: "selected", type: "paragraph", runs: [{ text: "18 dollars" }] }, { id: "unrelated", type: "paragraph", runs: [{ text: "DO_NOT_SEND" }] }] }] });
  const input = languageInputSchema.parse({ purpose: "document.edit", prompt: "Price 20", artifactId: "doc", baseRevision: 3, sectionId: "s", blockIds: ["selected"], range: { blockId: "selected", leafId: "selected", start: 0, end: 2, expectedText: "18" } });
  const messages = creationLanguageMessages({ input, source, assets: [] });
  expect(messages[0].content).toContain("replaceDocumentText");
  expect(messages[0].content).not.toContain("Coordinates are finite");
  expect(messages[1].content).toContain("18 dollars");
  expect(messages[1].content).not.toContain("DO_NOT_SEND");
  expect(() => creationLanguageMessages({ input: { ...input, range: { ...input.range, expectedText: "17" } }, source, assets: [] })).toThrow("DOCUMENT_TEXT_CHANGED");
});
