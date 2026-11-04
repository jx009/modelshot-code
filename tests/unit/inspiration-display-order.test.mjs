import { expect, it } from "vitest";
import { mixInspirationItems } from "../../src/lib/inspiration/display-order.js";

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

it("distributes a dominant category across every column instead of spending it on the left", () => {
  const mixed = mixInspirationItems([...works("poster", 90), ...works("commerce", 10)]);
  // With equal-height cards these slices are the five CSS masonry columns.
  for (let offset = 0; offset < mixed.length; offset += 20) {
    const column = mixed.slice(offset, offset + 20);
    expect(column.some(item => item.category === "poster")).toBe(true);
    expect(column.some(item => item.category === "commerce")).toBe(true);
  }
});

it("handles empty and single-category galleries without dropping or duplicating cards", () => {
  expect(mixInspirationItems([])).toEqual([]);
  const items = works("poster", 10);
  const mixed = mixInspirationItems(items);
  expect(mixed).toHaveLength(10);
  expect(new Set(mixed.map(item => item.id)).size).toBe(10);
  expect(mixed).toEqual(mixInspirationItems(items));
});
