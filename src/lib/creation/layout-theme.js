const canonical = color => color.toLowerCase().replace(/^(.{7})ff$/, "$1");

function replacement(value, oldTheme, theme) {
  const matches = ["primary", "accent", "background"].filter(key => canonical(oldTheme[key]) === canonical(value));
  // Shared old colors have no recorded role. Leave them unchanged if the new
  // tokens diverge; do not guess whether custom text is primary or accent.
  if (!matches.length || new Set(matches.map(key => canonical(theme[key]))).size !== 1) return null;
  const next = theme[matches[0]];
  return canonical(value) === canonical(next) ? null : next;
}

function boundReplacement(value, role, oldTheme, theme) {
  if (role === "custom") return null;
  if (!role) return replacement(value, oldTheme, theme);
  return canonical(value) === canonical(theme[role]) ? null : theme[role];
}

export function createThemeOperation(document, theme) {
  const pages = [];
  document.pages.forEach((page, index) => {
    const nodes = [];
    page.nodes.forEach((node, nodeIndex) => {
      if (node.locked || node.type === "image") return;
      const fill = boundReplacement(node.type === "text" ? node.style.fill : node.fill, node.type === "text" ? node.style.fillRole : node.fillRole, document.theme, theme);
      const stroke = node.type === "shape" ? boundReplacement(node.stroke, node.strokeRole, document.theme, theme) : null;
      const font = node.type === "text" && node.style.fontRole !== "custom" && (node.style.fontRole === "theme" || node.style.fontFamily === document.theme.fontFamily) && node.style.fontFamily !== theme.fontFamily ? theme.fontFamily : null;
      if (fill !== null || stroke !== null || font !== null) nodes.push([nodeIndex, fill, stroke, font]);
    });
    const background = page.backgroundRole ? boundReplacement(page.background, page.backgroundRole, document.theme, theme) ?? undefined : canonical(page.background) === canonical(document.theme.background) && canonical(page.background) !== canonical(theme.background) ? theme.background : undefined;
    if (nodes.length || background !== undefined) pages.push({ index, ...(background === undefined ? {} : { background }), nodes });
  });
  return { op: "setTheme", theme, pages };
}

export function applyThemeOperation(document, operation, fail) {
  if (operation.pages.length > 100) fail("INVALID_THEME_PATCH");
  let count = 0;
  const seen = new Set(), pages = [...document.pages];
  for (const patch of operation.pages) {
    const page = document.pages[patch.index];
    if (!page || seen.has(patch.index) || patch.nodes.length > 500) fail("INVALID_THEME_PATCH");
    seen.add(patch.index);
    count += patch.nodes.length;
    if (count > 5000) fail("DOCUMENT_NODE_LIMIT");
    const nodes = [...page.nodes], seenNodes = new Set();
    for (const [index, fill, stroke, font] of patch.nodes) {
      const node = page.nodes[index];
      if (!node || seenNodes.has(index) || (fill === null && stroke === null && font === null)) fail("INVALID_THEME_PATCH");
      seenNodes.add(index);
      if (node.locked) fail("NODE_LOCKED");
      if (node.type === "text" && stroke === null) {
        nodes[index] = { ...node, style: { ...node.style, ...(fill === null ? {} : { fill }), ...(font === null ? {} : { fontFamily: font }) } };
      } else if (node.type === "shape" && font === null) {
        nodes[index] = { ...node, ...(fill === null ? {} : { fill }), ...(stroke === null ? {} : { stroke }) };
      } else fail("INVALID_THEME_PATCH");
    }
    pages[patch.index] = { ...page, nodes: patch.nodes.length ? nodes : page.nodes, ...(patch.background === undefined ? {} : { background: patch.background }) };
  }
  return { ...document, theme: operation.theme, pages: operation.pages.length ? pages : document.pages };
}

// Called after application validates the targets. Preserve exact old values,
// including color spelling, so collisions in the new palette cannot corrupt undo.
export function inverseThemeOperation(document, operation) {
  return { op: "setTheme", theme: document.theme, pages: operation.pages.map(patch => {
    const page = document.pages[patch.index];
    return { index: patch.index, ...(patch.background === undefined ? {} : { background: page.background }), nodes: patch.nodes.map(([index, fill, stroke, font]) => {
      const node = page.nodes[index];
      return [index, fill === null ? null : node.type === "text" ? node.style.fill : node.fill, stroke === null ? null : node.stroke, font === null ? null : node.style.fontFamily];
    }) };
  }) };
}
