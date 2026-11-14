import { expect, it } from "vitest";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { posterImageStep } from "../../src/lib/creation/contracts/poster-image.js";
import { posterDesignContext } from "../../src/lib/creation/poster-design.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";

it("shares aspect-aware poster composition with image and editable HTML prompts", () => {
  const input = languageInputSchema.parse({ purpose: "poster.generate", sourceFormat: "html", prompt: "Exact headline: 春日新品, price 29", width: 1080, height: 1440 });
  const messages = creationLanguageMessages({ input, assets: [] }), payload = JSON.parse(messages[1].content);
  expect(messages).toHaveLength(2);
  expect(payload.compositionGuide).toEqual(posterDesignContext(input));
  expect(payload.compositionGuide).toMatchObject({ orientation: "portrait", safeMargin: 59, headlineSize: 103, bodySize: 30 });
  expect(posterDesignContext({ width: 1600, height: 900 }).orientation).toBe("landscape");
  expect(posterDesignContext({ width: 1080, height: 1080 }).orientation).toBe("square");
  expect(messages[0].content).toContain("metadata.design");
  expect(messages[0].content).toContain("separate layers");
  const step = posterImageStep({ ...input, image: { size: "1024x1536" } });
  expect(step.params.prompt).toContain("portrait poster (1080 x 1440)");
  expect(step.params.prompt).toContain("春日新品");
  expect(posterImageStep({ ...input, prompt: "长".repeat(12000), image: { size: "1024x1536" } }).params.prompt.length).toBeLessThanOrEqual(4000);
});

it("preserves a bounded poster design brief in scoped AI edit context", () => {
  const design = { concept: "New launch", composition: "Asymmetric", typography: "Bold headline", imageTreatment: "Uncropped product" };
  const source = { schemaVersion: 3, format: "html-poster", kind: "poster", title: "Poster", metadata: { design }, theme: {}, pages: [{ id: "page", html: '<p data-node-id="title">Exact title</p>' }] };
  const input = languageInputSchema.parse({ purpose: "poster.edit", sourceFormat: "html", prompt: "修改标题颜色", artifactId: "poster", baseRevision: 1, pageId: "page", nodeIds: ["title"] });
  const messages = creationLanguageMessages({ input, source, assets: [] });
  expect(JSON.parse(messages[1].content).posterDesign).toEqual(design);
  expect(JSON.parse(messages[1].content).request.nodeIds).toEqual(["title"]);
  expect(messages[0].content).toContain("never expands the selected edit scope");
  source.metadata.design = { ...design, concept: "x".repeat(10000) };
  expect(JSON.parse(creationLanguageMessages({ input, source, assets: [] })[1].content).posterDesign).toBeUndefined();
});

const plan = () => ({ rowCount: 28, columnFormats: ["general", "currency"], rows: [{ startRow: 2, endRow: 27, brief: "按源文件顺序的 26 条记录" }], totals: [{ column: 2, operation: "SUM" }] });
const chunkInput = () => ({ purpose: "sheet.chunk", sheetId: "s", columns: ["编号", "金额"], locale: "zh", plan: plan(), startRow: 1, endRow: 25 });