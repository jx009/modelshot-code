import { afterEach, describe, expect, it, vi } from "vitest";
import { imageCreditCost, resolutionSurcharges, imageBillingResolutions } from "../../src/lib/studio/image-pricing.js";
import { capabilities } from "../../src/lib/domain/studio/providers.js";
import { getResolutionSurcharges } from "../../src/lib/domain/billing/resolution-pricing.js";
import { validatePlan } from "../../src/lib/studio/tools.js";

const prices = { "1K": 1, "2K": 2, "4K": 4 };
afterEach(() => vi.unstubAllEnvs());

describe("model base plus global resolution pricing", () => {
  it("adds the selected resolution surcharge to the model base for every aspect ratio", () => {
    const offer = { creditCost: 18, resolutionSurcharges: prices };
    for (const size of ["1024x1024", "1024x1536", "1536x1024", "9:16@1K"]) expect(imageCreditCost(offer, size)).toBe(19);
    for (const size of ["1:1@2K", "auto@2K", "21:9@2K"]) expect(imageCreditCost(offer, size)).toBe(20);
    expect(imageCreditCost(offer, "4:1@4K") * 4).toBe(88);
    expect(imageCreditCost({ ...offer, creditCost: 30 }, "1:1@2K")).toBe(32);
  });
  it("zero surcharge preserves the base; free images require both values to be zero", () => {
    expect(imageCreditCost({ cost: 4 }, "1:1@4K")).toBe(4);
    expect(imageCreditCost({ creditCost: 18, resolutionSurcharges: { ...prices, "2K": 0 } }, "1:1@2K")).toBe(18);
    expect(imageCreditCost({ creditCost: 0, resolutionSurcharges: { "1K": 0, "2K": 0, "4K": 0 } }, "1:1@1K")).toBe(0);
    expect(resolutionSurcharges(null)).toEqual({ "1K": 0, "2K": 0, "4K": 0 });
    expect(resolutionSurcharges({ "1K": 0, "2K": -10, "4K": 1.5 })).toEqual({ "1K": 0, "2K": 0, "4K": 0 });
    expect(imageCreditCost({ creditCost: 100000, resolutionSurcharges: { ...prices, "4K": 100000 } }, "1:1@4K")).toBe(200000);
  });
  it("adds the surcharge for the actual adapted resolution in guided edits", () => {
    const ark = { cost: 18, resolutionSurcharges: prices, billingResolutions: imageBillingResolutions("expand", { imageKind: "volcengine" }) };
    expect(imageCreditCost(ark, "1:1@1K")).toBe(20);
    expect(imageCreditCost(ark, "1:1@4K")).toBe(22);
    const legacy = { cost: 18, resolutionSurcharges: prices, billingResolutions: imageBillingResolutions("inpaint", { imageKind: "dashscope", imageModel: "qwen-image-edit" }) };
    expect(imageCreditCost(legacy, "1:1@4K")).toBe(19);
  });
  it("applies the same global extras to public and dedicated models, leaving OCR and upscale fixed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    let extras = prices;
    const rows = [
      { name: "public", kind: "openai", displayName: "Public", creditCost: 18, config: JSON.stringify({ model: "fixture" }) },
      { name: "editor", kind: "openai", displayName: "Editor", creditCost: 25, config: JSON.stringify({ model: "fixture-edit", scope: "tool" }) },
    ];
    const settings = [{ toolId: "inpaint", creditCost: 99, routing: { mode: "dedicated", channelName: "editor" } }, { toolId: "ocr", creditCost: 2 }, { toolId: "upscale", creditCost: 8 }];
    const db = { systemConfig: { findUnique: async () => ({ value: JSON.stringify(extras) }) }, modelProvider: { findMany: async () => rows }, studioToolConfig: { findMany: async () => settings } };
    const caps = await capabilities(db, undefined, "public");
    expect(caps.imageModels).toHaveLength(1);
    expect(caps.imageModels[0].creditCost).toBe(18);
    expect(caps.imageModels[0].resolutionSurcharges).toEqual(prices);
    expect(imageCreditCost(caps.tools.find(t => t.id === "generate"), "1:1@4K")).toBe(22);
    expect(imageCreditCost(caps.tools.find(t => t.id === "inpaint"), "1:1@4K")).toBe(29);
    expect(imageCreditCost(caps.tools.find(t => t.id === "ocr"), "1:1@4K")).toBe(2);
    expect(imageCreditCost(caps.tools.find(t => t.id === "upscale"), "1:1@4K")).toBe(8);
    extras = { ...prices, "4K": 6 };
    const updated = await capabilities(db, undefined, "public");
    expect(imageCreditCost(updated.tools.find(t => t.id === "generate"), "1:1@4K")).toBe(24);
  });
  it("starts with zero extras when no global pricing has been configured", async () => {
    expect(await getResolutionSurcharges({ systemConfig: { findUnique: async () => null } })).toEqual({ "1K": 0, "2K": 0, "4K": 0 });
  });
  it("sums base plus resolution for every plan step and keeps independent tools fixed", () => {
    const plan = validatePlan({ summary: "Test", steps: [
      { tool: "generate", params: { prompt: "Test", size: "1:1@4K" }, explanation: "Create" },
      { tool: "edit", params: { prompt: "Edit", size: "1:1@2K" }, explanation: "Refine" },
      { tool: "ocr", params: {}, explanation: "Read" },
    ] }, ["generate", "edit", "ocr"], false, { generate: { cost: 18, resolutionSurcharges: prices }, edit: { cost: 25, resolutionSurcharges: prices }, ocr: 2 });
    expect(plan.credits).toBe(51);
  });
});
