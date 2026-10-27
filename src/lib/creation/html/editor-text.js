// Text-only subtrees may contain inline emphasis, but never editable media,
// tables, or nested layout blocks. The artwork's original asset: URLs stay put.
import { inlineTextTags, textRootTags } from "./text-tags.js";
export function isEditableText(node) {
  return Boolean(node && textRootTags.has(node.tagName?.toLowerCase())
    && !node.closest("[data-cw-master]") && [...node.querySelectorAll("*")].every(child => inlineTextTags.has(child.tagName.toLowerCase())));
}
export function textEditTarget(node) {
  let target = node?.closest("[data-node-id]");
  while (target && inlineTextTags.has(target.tagName.toLowerCase()) && isEditableText(target.parentElement) && target.parentElement.hasAttribute("data-node-id")) target = target.parentElement;
  return isEditableText(target) ? target : null;
}
export function cleanTextChildren(node, destination) {
  return [...node.childNodes].map(child => {
    const clone = destination.importNode(child, true);
    const elements = clone.nodeType === 1 ? [clone, ...clone.querySelectorAll("*")] : [];
    for (const element of elements) {
      if (element.hasAttribute("data-cw-selected")) element.style.outline = element.getAttribute("data-cw-outline") || "";
      // A partial range can clone a span's data-node-id. Reassign descendants
      // once at commit, retaining the edited object's stable root ID.
      for (const attribute of [...element.attributes]) if (attribute.name.startsWith("data-cw-") || ["contenteditable", "spellcheck", "data-node-id"].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    return clone;
  });
}
// Apply to a range only when both ends belong to this text object. Otherwise
// format the complete object; do not use a stale selection from another page.
export function formatTextRange(node, property, value, savedRange) {
  const range = savedRange?.cloneRange();
  if (!range || range.collapsed || !node.contains(range.startContainer) || !node.contains(range.endContainer)) {
    node.style[property] = value;
    return null;
  }
  const span = node.ownerDocument.createElement("span");
  span.style[property] = value; span.append(range.extractContents()); range.insertNode(span);
  range.selectNodeContents(span);
  const selection = node.ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  return range;
}
export function insertPlainText(node, text) {
  const selection = node.ownerDocument.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!node.contains(range.commonAncestorContainer)) return false;
  range.deleteContents();
  const inserted = node.ownerDocument.createTextNode(text); range.insertNode(inserted);
  range.setStartAfter(inserted); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  return true;
}
