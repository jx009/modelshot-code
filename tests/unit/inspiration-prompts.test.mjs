import { expect, it } from "vitest";
import { DEFAULT_ITEMS, defaultGallery, gallerySchema, inspirationPrompt, inspirationPromptZh } from "../../src/lib/inspiration/gallery.js";
import { caseRecipe } from "../../src/lib/commerce/case-recipe.js";

it("provides a complete Chinese prompt for every default artwork without replacing originals", () => {
  expect(gallerySchema.safeParse(defaultGallery).success).toBe(true);
  for (const item of DEFAULT_ITEMS) {
    expect(item.promptZh.length).toBeGreaterThan(100);
    expect(item.promptZh).toMatch(/[\u4e00-\u9fff]/);
    expect(inspirationPrompt(item, "zh")).toBe(item.promptZh);
    expect(caseRecipe(item, "zh").prompt).toBe(item.promptZh);
    expect(inspirationPrompt(item, "en")).toBe(item.prompt);
    expect(caseRecipe(item, "en").prompt).toBe(item.prompt);
  }
});

it("localizes previously saved defaults without changing admin order, images or configuration", () => {
  const legacy = DEFAULT_ITEMS.map(({ promptZh, ...item }) => item).reverse();
  const parsed = gallerySchema.parse({ items: legacy, layout: defaultGallery.layout });
  expect(parsed.items.map(i => i.id)).toEqual(legacy.map(i => i.id));
  for (const item of parsed.items) {
    expect(inspirationPrompt(item, "zh")).toBe(DEFAULT_ITEMS.find(i => i.id === item.id).promptZh);
    expect(item.cover).toEqual(legacy.find(i => i.id === item.id).cover);
  }
});

it("never applies a stale built-in translation to an edited or custom prompt", () => {
  const { promptZh, ...original } = DEFAULT_ITEMS[0];
  const edited = { ...original, prompt: "A completely different scene" };
  expect(inspirationPromptZh(edited)).toBe("");
  expect(inspirationPrompt(edited, "zh")).toBe(edited.prompt);
  const custom = { ...original, cover: { type: "asset", assetId: "custom" } };
  expect(inspirationPrompt(custom, "zh")).toBe(custom.prompt);
  expect(inspirationPrompt({ ...custom, promptZh: "管理员填写的中文内容" }, "zh")).toBe("管理员填写的中文内容");
  expect(inspirationPrompt({ ...original, promptZh: "" }, "zh")).toBe(original.prompt);
});
