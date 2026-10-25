import { expect, it } from "vitest";
import { languageInputSchema, outlineSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { confirmOutlineSchema } from "../../src/lib/creation/contracts/outline-review.js";
import { outlineChildren } from "../../src/lib/creation/outline-plan.js";
import { plannedSlideVisuals, slideDesignMarkdown } from "../../src/lib/creation/contracts/slide-design.js";
import { validateRunDependencyGraph, newlyUnblockedSteps } from "../../src/lib/creation/run-dependencies.js";
import { presentationWindow, presentationAssetWindow, presentationTime } from "../../src/lib/creation/html/presentation.js";

const theme = { name: "Editorial", primary: "#123456", accent: "#dd6600", background: "#ffffff", fontFamily: "sans" };
const design = { audience: "Product teams", narrative: "Problem, evidence, solution", artDirection: "Warm editorial photography", typography: "64px headlines, 28px body", spacing: "64px safe margins", visuals: [{ id: "hero", prompt: "A quiet workspace" }, { id: "process", prompt: "A connected workflow" }] };
const outline = (count = 3) => ({ title: "Launch", theme, design, pages: Array.from({ length: count }, (_, index) => ({ id: "page-" + index, title: "Slide " + index, brief: "Exact supplied facts", role: "Evidence", layout: index % 2 ? "Split comparison" : "Large hero", notes: "Discuss the evidence", visualId: index % 2 ? "process" : "hero" })) });
const run = count => ({ id: "run", kind: "slides", input: { width: 1280, height: 720 }, steps: [{ id: "outline", position: 0, status: "succeeded", dependsOn: [], params: languageInputSchema.parse({ purpose: "slides.outline", pageCount: count, prompt: "Launch the product", sourceFormat: "html" }) }] });

it("reads old outlines while rejecting dangling visual references and duplicate visual IDs", () => {
  expect(outlineSchema.parse({ title: "Old", theme, pages: [{ id: "old", title: "Old", brief: "Brief" }] }).design).toBeUndefined();
  expect(outlineSchema.safeParse({ ...outline(), pages: [{ ...outline().pages[0], visualId: "missing" }] }).success).toBe(false);
  expect(outlineSchema.safeParse({ ...outline(), design: { ...design, visuals: [design.visuals[0], design.visuals[0]] } }).success).toBe(false);
  expect(plannedSlideVisuals(outline(1))).toEqual([design.visuals[0]]);
});

it("preserves design and notes without scheduling paid images unless the user includes an image quote", () => {
  const plan = outlineChildren(run(3), outline(), 2);
  expect(plan.map(step => step.tool)).toEqual(["slides.page", "slides.page", "slides.page"]);
  expect(plan[0].status).toBe("ready");
  expect(plan[0].params.visualId).toBeUndefined();
  expect(plan[1].params.deck).toMatchObject({ pageNumber: 2, pageCount: 3, design: { artDirection: design.artDirection }, previousLayout: "Large hero", nextLayout: "Large hero" });
  expect(slideDesignMarkdown(outline())).toContain("## Typography");
  expect(slideDesignMarkdown(outline())).toContain("Visual: hero");
});

it("builds a bounded 100-page graph with two shared images, keeping only the local narrative context per page", () => {
  const initial = run(100), plan = outlineChildren(initial, outline(100), 2, { size: "1536x1024", expectedCost: 4, provider: "images" });
  const assembly = { id: "assembly", position: plan.length + 1, dependsOn: plan.map(step => step.id), status: "blocked" };
  expect(validateRunDependencyGraph([...initial.steps, ...plan, assembly])).toBe(true);
  expect(plan).toHaveLength(102);
  expect(plan.filter(step => step.status === "ready")).toHaveLength(1);
  expect(plan[1].dependsOn).toEqual([plan[0].id]);
  expect(plan[2].dependsOn).toEqual([plan[1].id]);
  expect(plan[2].params.visualId).toBe("hero");
  expect(plan[52].params.deck.headings.length).toBeLessThanOrEqual(7);
  expect(plan.reduce((sum, step) => sum + step.expectedCost, 0)).toBe(208);
  expect(newlyUnblockedSteps([...initial.steps, ...plan], new Set([plan[0].id])).map(step => step.id)).toEqual([plan[1].id]);
});

it("rejects image options on document outlines and missing generated image usage", () => {
  const data = { saveKey: "confirmation-key-123", expectedSequence: 1, expectedUnitCost: 2, maxCredits: 10, image: { size: "1536x1024", expectedCost: 4 } };
  expect(confirmOutlineSchema.safeParse({ ...data, outline: { title: "Document", sections: [{ id: "a", title: "Chapter", brief: "Write" }] } }).success).toBe(false);
  const input = { ...outlineChildren(run(1), outline(1), 2)[0].params, assetIds: ["generated"], visualAssetId: "generated" };
  const page = { id: "page-0", width: 1280, height: 720, html: "<h1>Launch</h1>" };
  expect(() => validateLanguageResult(input, page)).toThrow("LANGUAGE_VISUAL_ASSET_MISSING");
  expect(validateLanguageResult(input, { ...page, html: '<h1>Launch</h1><img src="asset:generated">' }).html).toContain("asset:generated");
});

it("preloads the next three and previous one, prioritizes active-page assets and keeps the asset budget bounded", () => {
  const pages = Array.from({ length: 20 }, (_, id) => ({ id }));
  expect(presentationWindow(pages, 5).map(page => page.id)).toEqual([4, 5, 6, 7, 8]);
  expect(presentationWindow(pages, 0).map(page => page.id)).toEqual([0, 1, 2, 3]);
  expect(presentationWindow(pages, 19).map(page => page.id)).toEqual([18, 19]);
  const ids = presentationAssetWindow(pages, 5, page => Array.from({ length: 8 }, (_, i) => page.id + "-" + i));
  expect(ids).toHaveLength(20);
  expect(ids.slice(0, 8)).toEqual(Array.from({ length: 8 }, (_, i) => "5-" + i));
  expect(presentationTime(3661)).toBe("61:01");
});
