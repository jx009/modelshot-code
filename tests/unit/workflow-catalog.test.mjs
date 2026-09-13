import { describe, expect, it } from "vitest";
import { configurationSchema } from "../../src/lib/domain/generation/contracts.js";
import { conversationPrompt, planAgentTurn } from "../../src/lib/domain/generation/agent-planner.js";
import { buildWorkflowTasks, getWorkflow, workflowOutputCount } from "../../src/lib/domain/generation/workflow-catalog.js";

describe("production workflow catalog", () => {
  it("turns a plain-language conversation into an executable production choice", () => {
    expect(planAgentTurn("给这款口红做一组小红书营销海报", {})).toMatchObject({ workflowId: "campaign-pack", productCategory: "beauty", needsModel: false, estimatedOutputs: 12, ready: false });
    expect(planAgentTurn("Create an Amazon detail page for these earbuds", { images: ["asset-1"] })).toMatchObject({ workflowId: "detail-page", productCategory: "electronics", platformSpec: "amazon", estimatedOutputs: 6 });
    expect(planAgentTurn("Keep the previous direction, but use softer light", { workflowId: "main-gallery", productCategory: "home" })).toMatchObject({ workflowId: "main-gallery", productCategory: "home" });
    expect(conversationPrompt([{ text: "First direction", workflowId: "sku-kit" }, { text: "Use warm light", workflowId: "sku-kit" }])).toContain("Brief 2: Use warm light");
  });
  it("reports missing information and recommends a low-cost preview", () => {
    const plan = planAgentTurn("做一整套上新视觉", { images: ["asset-1"] });
    expect(plan.clarifications).toEqual(["productCategory", "platform"]);
    expect(plan.previewWorkflow).toBe("product-polish");
    expect(plan.confidence).toBeGreaterThan(0.4);
  });
  it("expands a SKU kit into distinct, named deliverables", () => {
    const tasks = buildWorkflowTasks("sku-kit", "Base model direction.", {
      productName: "Wind shell",
      productFacts: { material: "100% nylon" },
    });

    expect(tasks).toHaveLength(6);
    expect(new Set(tasks.map(task => task.role)).size).toBe(6);
    expect(tasks.find(task => task.id === "hero").references).toEqual(["product"]);
    expect(tasks.find(task => task.id === "front").references).toEqual(["product", "model", "scene"]);
    expect(tasks.every(task => task.prompt.includes("Wind shell"))).toBe(true);
    expect(tasks.every(task => task.prompt.includes("100% nylon"))).toBe(true);
  });

  it("keeps product-only deliverables free of model direction and invented claims", () => {
    const hero = buildWorkflowTasks("sku-kit", "Put this garment on a smiling model.")[0];
    expect(hero.mode).toBe("product");
    expect(hero.prompt).not.toContain("smiling model");
    expect(hero.prompt).toContain("infer no materials, measurements, certifications or product claims");
  });

  it("counts workflow outputs and enforces the batch limit", () => {
    expect(workflowOutputCount("commerce-suite")).toBe(11);
    expect(workflowOutputCount("main-gallery")).toBe(5);
    expect(workflowOutputCount("detail-page")).toBe(6);
    expect(workflowOutputCount("campaign-pack")).toBe(12);
    expect(workflowOutputCount("reference-remix")).toBe(4);
    expect(workflowOutputCount("product-polish")).toBe(1);
    expect(workflowOutputCount("model-set", 2, 2)).toBe(16);
    expect(configurationSchema.safeParse({ images: Array.from({ length: 17 }, (_, i) => `asset-${i}`), personImage: "model", workflowId: "sku-kit" }).success).toBe(false);
    expect(getWorkflow("unknown").id).toBe("single-shot");
  });

  it("builds a confirmed agent plan with ordered groups, ratios and exact copy", () => {
    const tasks = buildWorkflowTasks("commerce-suite", "Use crisp daylight.", {
      productName: "Arc Lamp",
      productCategory: "home",
      productFacts: { material: "Brushed steel", feature: "Three brightness levels" },
      headline: "Light, precisely",
      subheadline: "Three brightness levels",
      copyLanguage: "en",
      referenceImages: [{ id: "style-1", role: "style" }],
    });

    expect(tasks.map(task => task.group)).toEqual(["main", "main", "main", "main", "main", "detail", "detail", "detail", "detail", "detail", "detail"]);
    expect(tasks.map(task => task.aspectRatio)).toEqual(["1:1", "1:1", "4:3", "1:1", "1:1", "3:4", "3:4", "3:4", "3:4", "3:4", "3:4"]);
    expect(tasks[5].prompt).toContain("Headline: Light, precisely");
    expect(tasks[5].prompt).toContain("add no other words");
    expect(tasks.every(task => task.prompt.includes("Arc Lamp"))).toBe(true);
  });
});
