// Pure, copy-on-write editor operations. This module deliberately imports no
// schema or renderer, so pointer/keyboard edits do not pull zod into the editor.
import { applyThemeOperation } from "./layout-theme.js";
import { applyBoundStyle, textThemeFields, shapeThemeFields, pageThemeFields } from "./layout-theme-bindings.js";
export class LayoutOperationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new LayoutOperationError(code); }
function atIndex(items, index, value) {
  if (!Number.isInteger(index) || index < 0 || index > items.length) fail("INVALID_POSITION");
  return [...items.slice(0, index), value, ...items.slice(index)];
}
function reorder(items, index, target) {
  if (!Number.isInteger(target) || target < 0 || target >= items.length) fail("INVALID_POSITION");
  const copy = [...items], [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}
function changePage(document, pageId, change) {
  const index = document.pages.findIndex(page => page.id === pageId);
  if (index < 0) fail("PAGE_NOT_FOUND");
  const previous = document.pages[index], next = change(previous);
  if (next === previous) return document;
  const pages = [...document.pages]; pages[index] = next;
  return { ...document, pages };
}

export function applyLayoutOperation(document, operation, { allowLocked = false } = {}) {
  const { op } = operation;
  if (op === "setTheme") return applyThemeOperation(document, operation, fail);
  if (op === "setTitle") return document.title === operation.title ? document : { ...document, title: operation.title };
  if (op === "insertPage") {
    if (document.kind === "poster" || document.pages.length >= 100) fail("PAGE_LIMIT");
    if (document.pages.some(page => page.id === operation.page.id)) fail("DUPLICATE_PAGE_ID");
    if (document.pages.reduce((count, page) => count + page.nodes.length, 0) + operation.page.nodes.length > 5000) fail("DOCUMENT_NODE_LIMIT");
    return { ...document, pages: atIndex(document.pages, operation.index ?? document.pages.length, operation.page) };
  }
  if (["removePage", "reorderPage"].includes(op)) {
    const index = document.pages.findIndex(page => page.id === operation.pageId);
    if (index < 0) fail("PAGE_NOT_FOUND");
    if (op === "removePage") {
      if (document.pages.length === 1) fail("LAST_PAGE_REQUIRED");
      return { ...document, pages: document.pages.filter(page => page.id !== operation.pageId) };
    }
    return { ...document, pages: reorder(document.pages, index, operation.index) };
  }
  return changePage(document, operation.pageId, page => {
    if (op === "replacePageLayout") {
      if (page.nodes.some(node => node.locked)) fail("NODE_LOCKED");
      if (operation.nodes.some(node => node.locked)) fail("REPLACEMENT_LOCKED_NODE");
      if (operation.nodes.length > 500) fail("NODE_LIMIT");
      if (new Set(operation.nodes.map(node => node.id)).size !== operation.nodes.length) fail("DUPLICATE_NODE_ID");
      if (document.pages.reduce((count, item) => count + (item.id === page.id ? operation.nodes.length : item.nodes.length), 0) > 5000) fail("DOCUMENT_NODE_LIMIT");
      return { ...applyBoundStyle(page, { background: operation.background, backgroundRole: operation.backgroundRole ?? null }, document.theme, pageThemeFields), nodes: operation.nodes };
    }
    if (op === "setPage") return applyBoundStyle(page, operation.changes, document.theme, pageThemeFields);
    if (op === "insertNode") {
      if (page.nodes.length >= 500) fail("NODE_LIMIT");
      if (document.pages.reduce((count, item) => count + item.nodes.length, 0) >= 5000) fail("DOCUMENT_NODE_LIMIT");
      if (page.nodes.some(node => node.id === operation.node.id)) fail("DUPLICATE_NODE_ID");
      return { ...page, nodes: atIndex(page.nodes, operation.index ?? page.nodes.length, operation.node) };
    }
    const index = page.nodes.findIndex(node => node.id === operation.nodeId);
    if (index < 0) fail("NODE_NOT_FOUND");
    const node = page.nodes[index];
    const unlocking = op === "setNode" && operation.changes.locked === false && Object.keys(operation.changes).length === 1;
    if (node.locked && !allowLocked && !unlocking) fail("NODE_LOCKED");
    if (op === "removeNode") return { ...page, nodes: page.nodes.filter(item => item.id !== node.id) };
    if (op === "reorderNode") return { ...page, nodes: reorder(page.nodes, index, operation.index) };
    let next;
    if (op === "setNode") next = { ...node, ...operation.changes };
    else if (op === "setText") { if (node.type !== "text") fail("TEXT_NODE_REQUIRED"); next = { ...node, text: operation.text }; }
    else if (op === "setTextStyle") { if (node.type !== "text") fail("TEXT_NODE_REQUIRED"); next = { ...node, style: applyBoundStyle(node.style, operation.style, document.theme, textThemeFields) }; }
    else if (op === "replaceImage") { if (node.type !== "image") fail("IMAGE_NODE_REQUIRED"); next = { ...node, assetId: operation.assetId, ...(operation.alt === undefined ? {} : { alt: operation.alt }) }; }
    else if (op === "setImageStyle") { if (node.type !== "image") fail("IMAGE_NODE_REQUIRED"); next = { ...node, ...operation.changes }; }
    else if (op === "setShapeStyle") { if (node.type !== "shape") fail("SHAPE_NODE_REQUIRED"); next = applyBoundStyle(node, operation.changes, document.theme, shapeThemeFields); }
    else fail("UNKNOWN_LAYOUT_OPERATION");
    const nodes = [...page.nodes]; nodes[index] = next;
    return { ...page, nodes };
  });
}

export function applyLayoutOperations(document, operations, options) {
  return operations.reduce((current, operation) => applyLayoutOperation(current, operation, options), document);
}

export function inspectLayout(document) {
  const issues = [];
  for (const page of document.pages) {
    if (!page.nodes.some(node => node.visible)) issues.push({ code: "EMPTY_PAGE", pageId: page.id });
    for (const node of page.nodes) {
      if (!node.visible) continue;
      if (!node.rotation && (node.x < 0 || node.y < 0 || node.x + node.width > page.width || node.y + node.height > page.height)) issues.push({ code: "NODE_OUTSIDE_PAGE", pageId: page.id, nodeId: node.id });
      if (node.type === "text") {
        // A lower bound catches explicit newlines; renderer font measurements
        // must still check wrapped text before export.
        const lines = node.text.split("\n").length;
        if (lines * node.style.fontSize * node.style.lineHeight > node.height + 1) issues.push({ code: "TEXT_HEIGHT_OVERFLOW", pageId: page.id, nodeId: node.id });
      }
    }
  }
  return issues;
}
