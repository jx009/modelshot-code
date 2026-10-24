export const CREATION_MESSAGE_WINDOW = 200;

// Keep a contiguous, bounded window. A gap is explicit: never join two distant
// pages and imply the omitted messages did not exist.
export function mergeConversationWindow(current, page, mode = "refresh") {
  if (mode === "latest" || !current.items.length) return { items: page.items.slice(-CREATION_MESSAGE_WINDOW), nextCursor: page.nextCursor, hasNewer: false };
  if (mode === "refresh") {
    if (!page.items.length) return current;
    const last = current.items.at(-1), first = page.items[0];
    if (current.hasNewer || first.sequence > last.sequence + 1) return { ...current, hasNewer: true };
  }
  const byId = new Map(current.items.map(item => [item.id, item]));
  for (const item of page.items) byId.set(item.id, item);
  const merged = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
  return {
    items: merged.slice(0, CREATION_MESSAGE_WINDOW),
    nextCursor: mode === "older" ? page.nextCursor : current.nextCursor,
    hasNewer: Boolean(current.hasNewer || merged.length > CREATION_MESSAGE_WINDOW),
  };
}
