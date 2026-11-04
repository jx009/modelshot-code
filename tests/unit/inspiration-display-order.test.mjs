import { expect, it } from "vitest";
import { inspirationColumns, mixInspirationItems, SHOWCASE_IDS } from "../../src/lib/inspiration/display-order.js";
import { DEFAULT_ITEMS } from "../../src/lib/inspiration/defaults.js";

const works = (category, count) => Array.from({ length: count }, (_, index) => ({ id: `${category}-${index}`, category }));

it("spreads grouped posters, products and illustrations throughout the gallery", () => {
  const items = [...works("poster", 12), ...works("commerce", 6), ...works("illustration", 6)];
  const snapshot = structuredClone(items);
  const mixed = mixInspirationItems(items);
  expect(mixed).toHaveLength(items.length);
  expect(new Set(mixed.map(item => item.id))).toEqual(new Set(items.map(item => item.id)));
  // Each vertical stretch contains different types instead of one category.
  for (let offset = 0; offset < mixed.length; offset += 6) {
    expect(new Set(mixed.slice(offset, offset + 6).map(item => item.category)).size).toBeGreaterThan(1);
  }
  expect(items).toEqual(snapshot);
  expect(mixed.every(item => items.includes(item))).toBe(true);
});

it("keeps the same order when refreshed delivery URLs or source ordering change", () => {
  const items = [...works("poster", 8), ...works("commerce", 4), ...works("fashion", 4)];
  const refreshed = [...items].reverse().map(item => ({ ...item, imageUrl: `https://cdn.example.com/${item.id}?signature=new` }));
  expect(mixInspirationItems(refreshed).map(item => item.id)).toEqual(mixInspirationItems(items).map(item => item.id));
});

it("distributes a dominant category throughout the feed", () => {
  const mixed = mixInspirationItems([...works("poster", 90), ...works("commerce", 10)]);
  for (let offset = 0; offset < mixed.length; offset += 20) {
    const column = mixed.slice(offset, offset + 20);
    expect(column.some(item => item.category === "poster")).toBe(true);
    expect(column.some(item => item.category === "commerce")).toBe(true);
  }
});

it("puts the new styles on the actual first screen at every supported column count", () => {
  const mixed = mixInspirationItems(DEFAULT_ITEMS);
  expect(mixed.slice(0, 12).map(item => item.id)).toEqual(SHOWCASE_IDS);
  for (const count of [2, 3, 4, 5]) {
    const columns = inspirationColumns(mixed, count);
    expect(columns.map(column => column[0].id)).toEqual(SHOWCASE_IDS.slice(0, count));
    for (const column of columns) expect(SHOWCASE_IDS).toContain(column[1].id);
    expect(new Set(columns.flat().map(item => item.id)).size).toBe(DEFAULT_ITEMS.length);
  }
});

it("separates variants of the same shoe campaign even when the collection has no new works", () => {
  const items = DEFAULT_ITEMS.filter(item => !SHOWCASE_IDS.includes(item.id));
  const mixed = mixInspirationItems(items);
  const positions = mixed.flatMap((item, index) => item.id.startsWith("sneaker-") ? [index] : []);
  expect(positions).toHaveLength(4);
  expect(positions.filter(position => position < 12).length).toBeLessThanOrEqual(2);
  for (let index = 1; index < positions.length; index++) expect(positions[index] - positions[index - 1]).toBeGreaterThanOrEqual(6);
});

it("keeps every column's first card at the top and places later cards in the shortest column", () => {
  const items = [
    { id: "tall", size: "100x200" }, { id: "wide", size: "200x100" },
    { id: "square", size: "100x100" }, { id: "last", size: "100x100" },
  ];
  expect(inspirationColumns(items, 2).map(column => column.map(item => item.id))).toEqual([["tall"], ["wide", "square", "last"]]);
});

it("handles empty and single-category galleries without dropping or duplicating cards", () => {
  expect(mixInspirationItems([])).toEqual([]);
  const items = works("poster", 10);
  const mixed = mixInspirationItems(items);
  expect(mixed).toHaveLength(10);
  expect(new Set(mixed.map(item => item.id)).size).toBe(10);
  expect(mixed).toEqual(mixInspirationItems(items));
});
