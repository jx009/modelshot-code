import { expect, it } from "vitest";
import { DEFAULT_ITEMS, DEFAULT_LAYOUT, LEGACY_ITEMS, PREVIOUS_DEFAULT_ITEMS } from "../../src/lib/inspiration/defaults.js";
import { VIBRANT_ITEMS } from "../../src/lib/inspiration/vibrant-defaults.js";
import { DIVERSE_ITEMS } from "../../src/lib/inspiration/diverse-defaults.js";
import { defaultGallery, gallerySchema, upgradeDefaultGallery } from "../../src/lib/inspiration/gallery.js";
import { caseRecipe } from "../../src/lib/commerce/case-recipe.js";
import { coverAspect } from "../../src/lib/inspiration/presentation.js";

it("adds twelve distinct showcase works without replacing the previous forty", () => {
  expect(DEFAULT_ITEMS).toHaveLength(52);
  expect(DIVERSE_ITEMS).toHaveLength(12);
  expect(VIBRANT_ITEMS).toHaveLength(20);
  expect(LEGACY_ITEMS).toHaveLength(20);
  expect(DEFAULT_ITEMS.slice(0, 40)).toEqual(PREVIOUS_DEFAULT_ITEMS);
  expect(DEFAULT_ITEMS.slice(20, 40)).toEqual(LEGACY_ITEMS);
  expect(new Set(DEFAULT_ITEMS.map(item => item.id)).size).toBe(52);
  expect(gallerySchema.safeParse(defaultGallery).success).toBe(true);
  expect(new Set(VIBRANT_ITEMS.map(item => item.generationSize))).toEqual(new Set(["3:4@2K", "9:16@2K", "1:1@2K", "16:9@2K"]));
  for (const item of VIBRANT_ITEMS) {
    expect(item.enabled).toBe(true);
    expect(item.model).toBe("gpt-image-2.5");
    expect(item.imageVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(item.prompt).not.toContain("--ar");
    expect(caseRecipe(item)).toMatchObject({ size: item.generationSize, outputCount: 2, reference: null });
    expect(coverAspect(item)).toBe(item.size.replace("x", " / "));
  }
  for (const item of DIVERSE_ITEMS) {
    expect(item.model).toBe("gpt-image-2.5");
    expect(item.enabled).toBe(true);
    expect(item.imageVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(coverAspect(item)).toBe(item.size.replace("x", " / "));
  }
});

it("upgrades only untouched legacy defaults, preserving the chosen layout", () => {
  const layout = { mode: "grid", columns: 3, gap: 24 };
  const old = gallerySchema.parse({ items: LEGACY_ITEMS.map(({ promptZh: _promptZh, ...item }) => item), layout });
  const upgraded = upgradeDefaultGallery(old);
  expect(upgraded.items).toEqual(DEFAULT_ITEMS);
  expect(upgraded.layout).toEqual(layout);
  expect(upgraded.catalogVersion).toBe(3);
  expect(upgradeDefaultGallery(upgraded)).toBe(upgraded);
});

it("upgrades untouched version two defaults but preserves edits, removals and latest-version deletions", () => {
  const previous = { items: PREVIOUS_DEFAULT_ITEMS, layout: DEFAULT_LAYOUT, catalogVersion: 2 };
  expect(upgradeDefaultGallery(previous)).toMatchObject({ items: DEFAULT_ITEMS, catalogVersion: 3 });
  const customized = [
    { ...previous, items: PREVIOUS_DEFAULT_ITEMS.slice(1) },
    { ...previous, items: [...PREVIOUS_DEFAULT_ITEMS].reverse() },
    { ...previous, items: PREVIOUS_DEFAULT_ITEMS.map((item, index) => index ? item : { ...item, enabled: false }) },
    { ...previous, items: PREVIOUS_DEFAULT_ITEMS.map((item, index) => index ? item : { ...item, title: "Edited" }) },
    { ...previous, catalogVersion: 3 },
  ];
  for (const gallery of customized) expect(upgradeDefaultGallery(gallery)).toBe(gallery);
});

it("does not restore removed or hidden works, overwrite edits, or reorder curated galleries", () => {
  const custom = [
    [],
    LEGACY_ITEMS.slice(1),
    [...LEGACY_ITEMS].reverse(),
    LEGACY_ITEMS.map((item, index) => index ? item : { ...item, enabled: false }),
    LEGACY_ITEMS.map((item, index) => index ? item : { ...item, prompt: "A completely different concept" }),
    LEGACY_ITEMS.map((item, index) => index ? item : { ...item, title: "Custom title" }),
    LEGACY_ITEMS.map((item, index) => index ? item : { ...item, cover: { type: "asset", assetId: "uploaded" } }),
  ];
  for (const items of custom) {
    const gallery = gallerySchema.parse({ items, layout: DEFAULT_LAYOUT });
    expect(upgradeDefaultGallery(gallery)).toBe(gallery);
  }
  const removedNewWorks = { items: LEGACY_ITEMS, layout: DEFAULT_LAYOUT, catalogVersion: 2 };
  expect(upgradeDefaultGallery(removedNewWorks)).toBe(removedNewWorks);
});

it("validates native dimensions independently from the supported generation recipe", () => {
  const item = { ...LEGACY_ITEMS[0], size: "1152x2048", generationSize: "9:16@2K", outputCount: 2 };
  expect(gallerySchema.safeParse({ items: [item], layout: DEFAULT_LAYOUT }).success).toBe(true);
  expect(caseRecipe(item).size).toBe("9:16@2K");
  for (const change of [{ size: "9999x9999" }, { size: "0x2000" }, { size: "100xInfinity" }, { size: "8192x8192" }, { generationSize: "9:16@8K" }, { generationSize: undefined }, { outputCount: 100 }]) {
    expect(gallerySchema.safeParse({ items: [{ ...item, ...change }], layout: DEFAULT_LAYOUT }).success).toBe(false);
  }
});
