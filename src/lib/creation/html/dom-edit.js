const select = (doc, id) => doc.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
const rootSelection = (doc, ids) => ids.map(id => select(doc, id)).filter(Boolean).filter(node => !ids.some(id => id !== node.dataset.nodeId && select(doc, id)?.contains(node)));
export function groupHtmlNodes(doc, ids, id) {
  const nodes = rootSelection(doc, ids);
  if (nodes.length < 2 || nodes.some(node => node.parentElement !== nodes[0].parentElement)) throw new Error("HTML_GROUP_REQUIRES_SIBLINGS");
  const siblings = [...nodes[0].parentElement.children];
  nodes.sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
  const first = siblings.indexOf(nodes[0]);
  if (nodes.some((node, index) => siblings[first + index] !== node)) throw new Error("HTML_GROUP_REQUIRES_ADJACENT_SIBLINGS");
  const contents = []; let current = nodes[0];
  while (current) { contents.push(current); if (current === nodes.at(-1)) break; current = current.nextSibling; }
  const group = doc.createElement("div"); group.dataset.nodeId = id; group.dataset.group = "true";
  group.style.display = "contents";
  // A semantic group preserves flex/grid layout. Geometry editing remains on
  // its children; grouping never rewrites the complete page as absolute boxes.
  nodes[0].before(group); contents.forEach(node => group.append(node));
  return id;
}
export function ungroupHtmlNode(doc, id) {
  const group = select(doc, id);
  if (!group || group.dataset.group !== "true" || group.style.display !== "contents") throw new Error("HTML_NOT_A_GROUP");
  group.replaceWith(...group.childNodes);
}
export function alignHtmlNodes(doc, rendered, ids, alignment) {
  const nodes = rootSelection(doc, ids);
  if (!nodes.length) return;
  const boxes = nodes.map(node => select(rendered, node.dataset.nodeId)?.getBoundingClientRect());
  if (boxes.some(box => !box)) throw new Error("HTML_SELECTION_CHANGED");
  const parent = select(rendered, nodes[0].dataset.nodeId)?.parentElement.getBoundingClientRect();
  const left = nodes.length === 1 ? parent.left : Math.min(...boxes.map(b => b.left));
  const right = nodes.length === 1 ? parent.right : Math.max(...boxes.map(b => b.right));
  const top = nodes.length === 1 ? parent.top : Math.min(...boxes.map(b => b.top));
  const bottom = nodes.length === 1 ? parent.bottom : Math.max(...boxes.map(b => b.bottom));
  nodes.forEach((node, index) => {
    const live = select(rendered, node.dataset.nodeId), css = rendered.defaultView.getComputedStyle(live), box = boxes[index];
    const dx = alignment === "left" ? left - box.left : alignment === "right" ? right - box.right : alignment === "center" ? (left + right - box.left - box.right) / 2 : 0;
    const dy = alignment === "top" ? top - box.top : alignment === "bottom" ? bottom - box.bottom : alignment === "middle" ? (top + bottom - box.top - box.bottom) / 2 : 0;
    if (!["absolute", "fixed"].includes(css.position)) node.style.position = "relative";
    if (dx) node.style.left = `${(parseFloat(css.left) || 0) + dx}px`;
    if (dy) node.style.top = `${(parseFloat(css.top) || 0) + dy}px`;
  });
}
export function inspectRenderedHtml(doc, width, height) {
  const issues = [], bounds = doc.body.getBoundingClientRect();
  for (const node of doc.querySelectorAll("[data-node-id]")) {
    const box = node.getBoundingClientRect(), style = doc.defaultView.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const id = node.dataset.nodeId;
    if (box.left < bounds.left - 1 || box.top < bounds.top - 1 || box.right > width + 1 || box.bottom > height + 1) issues.push({ id, code: "HTML_OUTSIDE_PAGE" });
    if (!node.children.length && node.textContent.trim() && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2) && style.overflow !== "visible") issues.push({ id, code: "HTML_TEXT_OVERFLOW" });
    if (node.tagName === "IMG" && (!node.complete || !node.naturalWidth)) issues.push({ id, code: "HTML_IMAGE_UNAVAILABLE" });
    if (issues.length >= 100) break;
  }
  return issues;
}
