// A bounded window keeps page frames alive during normal forward/back navigation.
// The current slide always comes first when scheduling private image requests.
export function presentationWindow(pages, index) {
  return pages.slice(Math.max(0, index - 1), Math.min(pages.length, index + 4));
}

export function presentationAssetWindow(pages, index, assetsFor, limit = 20) {
  const visible = presentationWindow(pages, index), ids = new Set();
  const priority = [pages[index], ...visible.filter(page => page !== pages[index])].filter(Boolean);
  for (const page of priority) for (const id of assetsFor(page)) {
    if (ids.size < limit || ids.has(id)) ids.add(id);
  }
  return [...ids];
}

export function presentationTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 60), value % 60].map(part => String(part).padStart(2, "0")).join(":");
}
