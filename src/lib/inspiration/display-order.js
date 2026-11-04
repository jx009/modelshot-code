// A stable shuffle keeps cached cards in place when image URLs are refreshed.
export const SHOWCASE_IDS = [
  "mist-river-scroll", "paper-coral-reef", "embroidered-orchard", "pixel-night-laundry",
  "clay-planet-garden", "botanical-lab-glass", "gouache-rooftop-cat", "woven-desert-lounge",
  "cyanotype-wildflowers", "linocut-whale", "film-morning-market", "charcoal-dancer",
];
const series = new Map([
  ["sneakers", ["sneaker-cobalt", "sneaker-chrome", "sneaker-track", "sneaker-editorial"]],
  ["cocoa", ["cocoa-lux", "cocoa-orbit", "cocoa-splash", "cocoa-strawberry"]],
  ["creators", ["neon-creator", "creator-pop", "creator-sticker", "creator-collage"]],
  ["clubs", ["club-festival", "club-riso", "club-future", "club-merch"]],
  ["architecture", ["architecture-red", "architecture-blueprint", "architecture-night", "architecture-terracotta"]],
].flatMap(([family, ids]) => ids.map(id => [id, family])));
const campaignFamilies = new Set(series.values());

export function inspirationSeries(item) {
  const source = item.cover?.type === "builtin" ? item.cover.file : item.id;
  return series.get(source) || (item.cover?.type === "asset" ? `asset:${item.cover.assetId}` : source);
}

function rank(id) {
  let value = 2166136261;
  for (const character of `inspiration-mix-v2:${id}`) {
    value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  }
  // Avalanche the bits so similar IDs don't produce neighbouring ranks.
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

export function mixInspirationItems(items) {
  const groups = new Map();
  for (const item of items) {
    const family = inspirationSeries(item);
    const key = campaignFamilies.has(family) ? `campaign:${family}` : item.category;
    const group = groups.get(key) || [];
    group.push({ item, rank: rank(item.id) });
    groups.set(key, group);
  }
  // Allocate categories throughout the feed, then keep campaign variants apart.
  const spread = [...groups.values()].flatMap(group => {
    group.sort((a, b) => a.rank - b.rank || a.item.id.localeCompare(b.item.id));
    return group.map((entry, index) => ({
      ...entry,
      slot: (index + 0.15 + 0.7 * (rank(`slot:${entry.item.id}`) / 4294967296)) / group.length,
    }));
  });
  spread.sort((a, b) => a.slot - b.slot || a.rank - b.rank || a.item.id.localeCompare(b.item.id));
  const pending = spread.map(entry => entry.item);
  const mixed = [];
  for (const id of SHOWCASE_IDS) {
    const index = pending.findIndex(item => item.id === id);
    if (index >= 0) mixed.push(...pending.splice(index, 1));
  }
  while (pending.length) {
    const recent = new Set(mixed.slice(-10).map(inspirationSeries));
    const index = pending.findIndex(item => !recent.has(inspirationSeries(item)));
    mixed.push(...pending.splice(index < 0 ? 0 : index, 1));
  }
  return mixed;
}

// Fill from left to right, adding the next card to the shortest column. Unlike
// CSS multicolumn, the beginning of the feed is also the visual first screen.
export function inspirationColumns(items, count, gapRatio = 0.05) {
  const columns = Array.from({ length: count }, () => []);
  const heights = Array(count).fill(0);
  for (const item of items) {
    const column = heights.indexOf(Math.min(...heights));
    const [width, height] = (item.size || "1x1").split("x").map(Number);
    columns[column].push(item);
    heights[column] += (width > 0 && height > 0 ? height / width : 1) + gapRatio;
  }
  return columns;
}
