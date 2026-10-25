// Only pass validated, CSP-protected, script-free preview HTML here. This is a
// disposable view; edits and saves always use the original asset: source.
function compatible(current, next) {
  return current.nodeType === next.nodeType && current.nodeName === next.nodeName
    && current.namespaceURI === next.namespaceURI
    && (current.nodeType !== 1 || current.getAttribute("data-node-id") === next.getAttribute("data-node-id"));
}
function patch(current, next, doc) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  // A late image must not replace an uncommitted text edit or IME composition.
  if (current.hasAttribute("contenteditable")) return;
  for (const attribute of [...current.attributes]) if (!next.hasAttributeNS(attribute.namespaceURI, attribute.localName)) current.removeAttributeNS(attribute.namespaceURI, attribute.localName);
  for (const attribute of next.attributes) if (current.getAttributeNS(attribute.namespaceURI, attribute.localName) !== attribute.value) current.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  const keyed = new Map([...current.children].filter(node => node.hasAttribute("data-node-id")).map(node => [node.getAttribute("data-node-id"), node]));
  let cursor = current.firstChild;
  for (const wanted of next.childNodes) {
    const id = wanted.nodeType === 1 ? wanted.getAttribute("data-node-id") : null;
    let node = id ? keyed.get(id) : cursor;
    if (!node || !compatible(node, wanted)) node = doc.importNode(wanted, true);
    if (node !== cursor) current.insertBefore(node, cursor);
    patch(node, wanted, doc);
    cursor = node.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
}
export function patchHtmlPreview(doc, html) {
  const next = new DOMParser().parseFromString(html, "text/html");
  patch(doc.documentElement, next.documentElement, doc);
}
