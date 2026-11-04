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
  expect(upgraded.catalogVersion).toBe(4);
  expect(upgradeDefaultGallery(upgraded)).toBe(upgraded);
});

it("adds the new collection to the live 39-card configuration without restoring its deleted drink", () => {
  const items = PREVIOUS_DEFAULT_ITEMS.filter(item => item.id !== "cocoa-lux");
  const gallery = { items, layout: DEFAULT_LAYOUT, catalogVersion: 2 };
  const upgraded = upgradeDefaultGallery(gallery);
  expect(upgraded.items).toHaveLength(51);
  expect(upgraded.items.slice(0, 12)).toEqual(DIVERSE_ITEMS);
  expect(upgraded.items.slice(12)).toEqual(items);
  expect(upgraded.items.some(item => item.id === "cocoa-lux")).toBe(false);
  expect(upgraded.catalogVersion).toBe(4);
});

it("preserves curated content, order and hidden states while adding only missing new artworks", () => {
  const hidden = { ...DIVERSE_ITEMS[0], enabled: false };
  const renamed = { ...DIVERSE_ITEMS[1], id: "custom-id", enabled: false };
  const items = [hidden, renamed, ...[...PREVIOUS_DEFAULT_ITEMS].reverse().slice(1).map((item, index) => index ? item : { ...item, title: "Custom title", enabled: false })];
  const gallery = { items, layout: { mode: "grid", columns: 3, gap: 24 }, catalogVersion: 2 };
  const upgraded = upgradeDefaultGallery(gallery);
  expect(upgraded.items).toEqual([...DIVERSE_ITEMS.slice(2), ...items]);
  expect(upgraded.layout).toEqual(gallery.layout);
  expect(gallery.items).toBe(items);
  expect(upgradeDefaultGallery(upgraded)).toBe(upgraded);
});

it("repairs version three galleries that never received any new artwork", () => {
  const gallery = { items: PREVIOUS_DEFAULT_ITEMS.slice(1), layout: DEFAULT_LAYOUT, catalogVersion: 3 };
  expect(upgradeDefaultGallery(gallery).items).toEqual([...DIVERSE_ITEMS, ...gallery.items]);
});

it("preserves empty galleries and deliberate removals after the new collection has been installed", () => {
  const empty = { items: [], layout: DEFAULT_LAYOUT, catalogVersion: 2 };
  expect(upgradeDefaultGallery(empty)).toBe(empty);
  const latest = { items: LEGACY_ITEMS, layout: DEFAULT_LAYOUT, catalogVersion: 4 };
  expect(upgradeDefaultGallery(latest)).toBe(latest);
  const curatedVersionThree = { items: [DIVERSE_ITEMS[0], ...LEGACY_ITEMS], layout: DEFAULT_LAYOUT, catalogVersion: 3 };
  expect(upgradeDefaultGallery(curatedVersionThree).items).toEqual(curatedVersionThree.items);
});

it("does not exceed the gallery limit or drop existing entries when adding new artworks", () => {
  const items = Array.from({ length: 199 }, (_, index) => ({ ...LEGACY_ITEMS[0], id: `custom-${index}`, cover: { type: "asset", assetId: `asset-${index}` } }));
  const upgraded = upgradeDefaultGallery({ items, layout: DEFAULT_LAYOUT, catalogVersion: 2 });
  expect(upgraded.items).toHaveLength(200);
  expect(upgraded.items.slice(1)).toEqual(items);
  expect(gallerySchema.safeParse(upgraded).success).toBe(true);
});

it("validates native dimensions independently from the supported generation recipe", () => {
  const item = { ...LEGACY_ITEMS[0], size: "1152x2048", generationSize: "9:16@2K", outputCount: 2 };
  expect(gallerySchema.safeParse({ items: [item], layout: DEFAULT_LAYOUT }).success).toBe(true);
  expect(caseRecipe(item).size).toBe("9:16@2K");
  for (const change of [{ size: "9999x9999" }, { size: "0x2000" }, { size: "100xInfinity" }, { size: "8192x8192" }, { generationSize: "9:16@8K" }, { generationSize: undefined }, { outputCount: 100 }]) {
    expect(gallerySchema.safeParse({ items: [{ ...item, ...change }], layout: DEFAULT_LAYOUT }).success).toBe(false);
  }
});
