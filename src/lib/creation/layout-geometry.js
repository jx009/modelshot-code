// Align the rotated object frame, excluding paint outside the frame (strokes).
// Pure arithmetic: no renderer, DOM measurements or whole-document traversal.
export function nodeFrameBounds(node) {
  const angle = node.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const xs = [0, node.width * cos, -node.height * sin, node.width * cos - node.height * sin];
  const ys = [0, node.width * sin, node.height * cos, node.width * sin + node.height * cos];
  const left = node.x + Math.min(...xs), top = node.y + Math.min(...ys);
  return { left, top, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

// Separating-axis test for a rotated object and the page. A bounding-box test
// alone accepts off-page corners whose enclosing box overlaps the page.
export function nodeIntersectsPage(node, page) {
  const angle = (node.rotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const centerX = node.x + (node.width * cos - node.height * sin) / 2;
  const centerY = node.y + (node.width * sin + node.height * cos) / 2;
  const dx = centerX - page.width / 2, dy = centerY - page.height / 2;
  return [[1, 0], [0, 1], [cos, sin], [-sin, cos]].every(([ax, ay]) => {
    const objectRadius = (node.width * Math.abs(ax * cos + ay * sin) + node.height * Math.abs(-ax * sin + ay * cos)) / 2;
    const pageRadius = (page.width * Math.abs(ax) + page.height * Math.abs(ay)) / 2;
    return Math.abs(dx * ax + dy * ay) < objectRadius + pageRadius - 1e-7;
  });
}

export function alignNodeToPage(node, page, alignment) {
  const bounds = nodeFrameBounds(node);
  switch (alignment) {
    case "left": return { x: node.x - bounds.left };
    case "center": return { x: node.x + (page.width - bounds.width) / 2 - bounds.left };
    case "right": return { x: node.x + page.width - bounds.width - bounds.left };
    case "top": return { y: node.y - bounds.top };
    case "middle": return { y: node.y + (page.height - bounds.height) / 2 - bounds.top };
    case "bottom": return { y: node.y + page.height - bounds.height - bounds.top };
    default: throw new Error("INVALID_ALIGNMENT");
  }
}

export function duplicateLayoutNode(node, id, suffix) {
  // A copy gets its own identity; preserve the image asset and all styling.
  // Shallow copy is safe because editor operations are copy-on-write.
  return { ...node, id, name: `${node.name.slice(0, Math.max(0, 159 - suffix.length))} ${suffix}`,
    x: Math.min(32768, node.x + 20), y: Math.min(32768, node.y + 20) };
}
