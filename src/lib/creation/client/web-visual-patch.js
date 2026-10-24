const fail = code => { throw new Error(code); };
const escapeText = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = value => escapeText(value).replace(/"/g, "&quot;");

const styleRules = {
  color: value => /^#[a-fA-F0-9]{6}$/.test(value),
  "font-size": value => /^(?:[8-9]|[1-9][0-9]|[12][0-9]{2}|300)px$/.test(value),
  "font-weight": value => /^(?:normal|bold|[1-9]00)$/.test(value),
  "text-align": value => ["left", "center", "right", "justify"].includes(value),
};
export function patchWebVisualSource(session, currentSource, targetId, { text, styles = {} }) {
  if (currentSource !== session.source) fail("WEB_SOURCE_CHANGED");
  const target = session.targets.get(targetId);
  if (!target) fail("WEB_VISUAL_SELECTION_CHANGED");
  if (typeof text !== "string" || text.length > 16000 || /[\u0000]/.test(text)) fail("WEB_VISUAL_TEXT_INVALID");
  const entries = Object.entries(styles);
  if (entries.length > 4 || entries.some(([key, value]) => !Object.hasOwn(styleRules, key) || typeof value !== "string" || !styleRules[key](value))) fail("WEB_VISUAL_STYLE_INVALID");
  const changes = [], location = target.location;
  if (text !== target.text) changes.push({ start: location.startTag.endOffset, end: location.endTag.startOffset, value: (target.tag === "pre" && text.startsWith("\n") ? "\n" : "") + escapeText(text) });
  if (entries.length) {
    // Parse only the selected element's style declaration, in a detached node.
    // No stylesheet or source DOM is attached to the application document.
    const node = document.createElement("span"); node.style.cssText = target.style;
    for (const [key, value] of entries) node.style.setProperty(key, value);
    const attribute = `style="${escapeAttribute(node.style.cssText)}"`, original = location.attrs?.style;
    changes.push(original ? { start: original.startOffset, end: original.endOffset, value: attribute }
      : { start: location.startTag.startOffset + 1 + target.tag.length, end: location.startTag.startOffset + 1 + target.tag.length, value: ` ${attribute}` });
  }
  let result = currentSource;
  for (const change of changes.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.value + result.slice(change.end);
  return result;
}
