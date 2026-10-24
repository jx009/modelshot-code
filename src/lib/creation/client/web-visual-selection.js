// The parent owns event handling. The edit frame has allow-same-origin only;
// generated scripts remain disabled both by sandbox and CSP.
export function bindWebVisualSelection(frameDocument, targets, onSelect, canSelect = () => true) {
  if (!frameDocument?.body) throw new Error("WEB_VISUAL_FRAME_UNAVAILABLE");
  let selected = null, originalOutline, originalOffset;
  const clear = () => {
    if (selected) {
      selected.style.setProperty("outline", originalOutline.value, originalOutline.priority);
      selected.style.setProperty("outline-offset", originalOffset.value, originalOffset.priority);
      selected = null;
    }
  };
  const selectElement = element => {
    if (!canSelect()) return;
    const id = element?.getAttribute("data-modelshot-edit-id"), target = targets.get(id);
    if (!target || element.localName !== target.tag || element.textContent !== target.text || element.children.length) { clear(); onSelect(null); return; }
    clear(); selected = element;
    const read = name => ({ value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) });
    originalOutline = read("outline"); originalOffset = read("outline-offset");
    selected.style.setProperty("outline", "2px solid #6366f1", "important"); selected.style.setProperty("outline-offset", "3px", "important");
    const color = frameDocument.defaultView?.getComputedStyle(element).color;
    const rgb = color?.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
    const hex = rgb ? `#${rgb.slice(1).map(part => Number(part).toString(16).padStart(2, "0")).join("")}` : null;
    onSelect({ id, tag: target.tag, text: target.text, color: hex });
  };
  const select = event => { event.preventDefault(); event.stopPropagation(); selectElement(event.target?.closest?.("[data-modelshot-edit-id]")); };
  const key = event => { if (event.key === "Escape" && canSelect()) { event.preventDefault(); clear(); onSelect(null); } };
  frameDocument.addEventListener("click", select, true); frameDocument.addEventListener("keydown", key, true);
  // Index once for keyboard-accessible selection; do not query/scan the DOM on
  // every text keystroke. IDs are generated offsets, never CSS from the source.
  const elements = new Map([...frameDocument.querySelectorAll("[data-modelshot-edit-id]")].map(element => [element.getAttribute("data-modelshot-edit-id"), element]));
  return {
    select: id => selectElement(elements.get(id)),
    dispose: () => { clear(); elements.clear(); frameDocument.removeEventListener("click", select, true); frameDocument.removeEventListener("keydown", key, true); },
  };
}
