const shallowEqual = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(key => a[key] === b[key]);
// HTML pages contain scalar fields. Keep unchanged page objects alive when the
// server appends another slide, so memoized projections/images do not rerender.
export function reconcileArtwork(current, incoming) {
  if (current?.schemaVersion !== 3 || incoming?.schemaVersion !== 3) return incoming;
  const pages = new Map(current.pages.map(page => [page.id, page]));
  return { ...incoming,
    pages: incoming.pages.map(page => shallowEqual(pages.get(page.id), page) ? pages.get(page.id) : page),
    theme: JSON.stringify(current.theme) === JSON.stringify(incoming.theme) ? current.theme : incoming.theme,
    ...(incoming.masters ? { masters: incoming.masters.map(master => {
      const previous = current.masters?.find(item => item.id === master.id);
      return shallowEqual(previous, master) ? previous : master;
    }) } : {}),
  };
}
