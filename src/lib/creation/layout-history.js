import { applyLayoutOperation, LayoutOperationError } from "./layout-operations.js";
import { inverseThemeOperation } from "./layout-theme.js";
import { inverseBoundStyle, textThemeFields, shapeThemeFields, pageThemeFields } from "./layout-theme-bindings.js";

function inverseFor(document, op) {
  if (op.op === "setTheme") return inverseThemeOperation(document, op);
  if (op.op === "setTitle") return { op: "setTitle", title: document.title };
  if (op.op === "insertPage") return { op: "removePage", pageId: op.page.id };
  const pageIndex = document.pages.findIndex(page => page.id === op.pageId), page = document.pages[pageIndex];
  if (!page) throw new LayoutOperationError("PAGE_NOT_FOUND");
  if (op.op === "removePage") return { op: "insertPage", page, index: pageIndex };
  if (op.op === "reorderPage") return { ...op, index: pageIndex };
  if (op.op === "setPage") return { ...op, changes: inverseBoundStyle(page, op.changes, pageThemeFields) };
  if (op.op === "replacePageLayout") return { op: "replacePageLayout", pageId: page.id, nodes: page.nodes, background: page.background, backgroundRole: page.backgroundRole ?? null };
  if (op.op === "insertNode") return { op: "removeNode", pageId: page.id, nodeId: op.node.id };
  const index = page.nodes.findIndex(node => node.id === op.nodeId), node = page.nodes[index];
  if (!node) throw new LayoutOperationError("NODE_NOT_FOUND");
  if (op.op === "removeNode") return { op: "insertNode", pageId: page.id, node, index };
  if (op.op === "reorderNode") return { ...op, index };
  if (op.op === "setText") return { ...op, text: node.text };
  if (op.op === "setTextStyle") return { ...op, style: inverseBoundStyle(node.style, op.style, textThemeFields) };
  if (op.op === "setShapeStyle") return { ...op, changes: inverseBoundStyle(node, op.changes, shapeThemeFields) };
  if (op.op === "replaceImage") return { ...op, assetId: node.assetId, alt: node.alt };
  if (["setNode", "setShapeStyle", "setImageStyle"].includes(op.op)) return { ...op, changes: Object.fromEntries(Object.keys(op.changes).map(key => [key, node[key]])) };
  throw new LayoutOperationError("UNKNOWN_LAYOUT_OPERATION");
}

export function applyWithInverse(document, operations) {
  let current = document;
  const inverse = [];
  for (const operation of operations) {
    const next = applyLayoutOperation(current, operation);
    const undo = inverseFor(current, operation);
    current = next;
    if (operation.op === "setNode" && operation.changes.locked === true && Object.keys(operation.changes).length > 1) {
      const { locked: _locked, ...changes } = undo.changes;
      inverse.unshift({ op: "setNode", pageId: operation.pageId, nodeId: operation.nodeId, changes: { locked: false } }, { ...undo, changes });
    } else inverse.unshift(undo);
  }
  return { document: current, inverse };
}
