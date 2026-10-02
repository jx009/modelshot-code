import { describe, expect, it } from "vitest";
import { applyDecision, imageDirection } from "../../src/lib/commerce/agent.js";
import { briefSchema, commerceSchema } from "../../src/lib/commerce/schema.js";
import { commerceContent, commerceReferences } from "../../src/lib/commerce/project.js";
import { contentSchema } from "../../src/lib/studio/tools.js";

const brief = briefSchema.parse({ product: "Chair", description: "Blue chair", language: "en" });
const card = id => ({ id, kind: "lifestyle", title: "A quiet corner", body: "A blue chair", eyebrow: "", layout: "inset", purpose: "Show room scale", direction: "Chair by a window, cool natural light", evidence: "Blue is visible in the product image" });
const decision = (count = 3) => ({ action: "plan", message: "A considered three-image collection", styleLock: "Soft window light and neutral backgrounds", evidence: ["Blue chair from user"], questions: [], sections: Array.from({ length: count }, (_, i) => card(`card-${i}`)) });
const empty = () => commerceSchema.parse({ version: 1, brief, sections: [], planning: "agent", productAssetId: "product", referenceAssetId: "style" });

describe("commerce agent planning boundaries", () => {
  it.each([1, 3, 7, 10])("accepts a tailored %i-card collection without fixed kinds", count => {
    const result = applyDecision(decision(count), empty());
    expect(result.sections).toHaveLength(count);
    expect(result.sections.every(s => s.prompt.includes("original product"))).toBe(true);
    expect(result.changed).toHaveLength(count);
  });
  it("respects the requested output count and rejects duplicate IDs", () => {
    expect(() => applyDecision(decision(3), { ...empty(), brief: { ...brief, imageCount: 2 } })).toThrow();
    const raw = decision(); raw.sections[1].id = raw.sections[0].id;
    expect(() => applyDecision(raw, empty())).toThrow("INVALID_AGENT_PLAN");
  });
  it("asks for missing facts without fabricating cards or losing the project", () => {
    const c = { ...empty(), sections: applyDecision(decision(), empty()).sections };
    const result = applyDecision({ ...decision(), action: "clarify", sections: [], questions: ["Which dimensions are verified?"] }, c);
    expect(result.sections).toEqual(c.sections);
    expect(result.changed).toEqual([]);
  });
  it("changes only the targeted card and preserves previous image as a revision reference", () => {
    const c = { ...empty(), sections: applyDecision(decision(), empty()).sections };
    const result = applyDecision({ ...decision(), action: "revise", sections: [{ ...card("card-1"), direction: "Outdoor scene" }] }, c, { targetSectionId: "card-1", previousAssets: { "card-1": "old-image" } });
    expect(result.sections[0]).toBe(c.sections[0]); expect(result.sections[2]).toBe(c.sections[2]);
    expect(result.sections[1].attempt).toBe(1);
    expect(commerceReferences(c, result.sections[1])).toEqual(["style", "old-image"]);
    expect(result.sections[1].prompt).toContain("last reference is the previous design");
    expect(() => applyDecision({ ...decision(), action: "revise" }, c, { targetSectionId: "card-1" })).toThrow();
  });
  it("refuses to silently replace an existing plan or exceed the bounded image/attempt budget", () => {
    const c = { ...empty(), sections: applyDecision(decision(10), empty()).sections };
    expect(() => applyDecision(decision(), c)).toThrow();
    expect(() => applyDecision({ ...decision(), action: "revise", sections: [card("extra")] }, c)).toThrow();
    c.sections[0].attempt = 50;
    expect(() => applyDecision({ ...decision(), action: "revise", sections: [card("card-0")] }, c)).toThrow();
  });
  it("includes exact copy, localization and identity constraints in every image request", () => {
    const prompt = imageDirection(brief, card("one"), "Warm palette");
    expect(prompt).toContain('"headline":"A quiet corner"');
    expect(prompt).toContain("Copy language: en");
    expect(prompt).toContain("no fabricated numbers");
    const longest = imageDirection({ ...brief, brand: "a".repeat(60) }, { ...card("one"), purpose: "a".repeat(300), direction: "a".repeat(1000), title: "a".repeat(70), body: "a".repeat(400), eyebrow: "a".repeat(60) }, "a".repeat(1200), true);
    expect(longest.length).toBeLessThanOrEqual(3800);
    expect(longest.endsWith("not a storyboard.")).toBe(true);
  });
  it("removes only explicitly listed cards from the plan and leaves historical assets untouched", () => {
    const c = { ...empty(), sections: applyDecision(decision(), empty()).sections };
    const result = applyDecision({ ...decision(), action: "revise", sections: [], removeIds: ["card-1"] }, c);
    expect(result.sections.map(s => s.id)).toEqual(["card-0", "card-2"]);
    expect(() => applyDecision({ ...decision(), action: "revise", sections: [], removeIds: ["unknown"] }, c)).toThrow();
    expect(() => applyDecision({ ...decision(), action: "revise", sections: [card("card-1")] }, { ...c, sections: result.sections, agent: { retiredIds: ["card-1"] } })).toThrow();
  });
});

it("preserves original, manual layers, conversation and every result attempt in a single canvas", () => {
  const c = { ...empty(), sections: applyDecision(decision(), empty()).sections };
  const before = commerceContent(null, c, [{ assetId: "product", width: 800, height: 600 }, { assetId: "style", width: 600, height: 600 }]);
  before.messages = [{ id: "first-message", role: "user", text: "First request" }];
  before.layers.push({ id: "manual", type: "text", name: "Note", text: "Keep this", x: 50, y: 700, width: 200, height: 50 });
  const jobs = [0, 1].map(attempt => ({ id: `job-${attempt}`, sectionId: "card-0", sectionAttempt: attempt, status: "succeeded", resultData: { assets: [{ id: `asset-${attempt}`, width: 1024, height: 1536 }] } }));
  const after = commerceContent(before, c, [], jobs);
  expect(after.layers).toHaveLength(5);
  expect(after.messages).toEqual(before.messages);
  expect(after.appliedJobs).toEqual(["job-0", "job-1"]);
  expect(commerceContent(after, c, [], jobs)).toEqual(after);
  expect(contentSchema.safeParse(after).success).toBe(true);
});
