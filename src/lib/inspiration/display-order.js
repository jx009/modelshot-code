// A stable shuffle keeps cached cards in place when image URLs are refreshed.
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
    const group = groups.get(item.category) || [];
    group.push({ item, rank: rank(item.id) });
    groups.set(item.category, group);
  }
  // Give every category slots throughout the *whole* feed. CSS masonry fills
  // top to bottom, so spending the largest category early clusters it on the
  // left. Vary each slot's offset to avoid a repeating category pattern.
  const spread = [...groups.values()].flatMap(group => {
    group.sort((a, b) => a.rank - b.rank || a.item.id.localeCompare(b.item.id));
    return group.map((entry, index) => ({
      ...entry,
      slot: (index + 0.15 + 0.7 * (rank(`slot:${entry.item.id}`) / 4294967296)) / group.length,
    }));
  });
  spread.sort((a, b) => a.slot - b.slot || a.rank - b.rank || a.item.id.localeCompare(b.item.id));
  return spread.map(entry => entry.item);
}
