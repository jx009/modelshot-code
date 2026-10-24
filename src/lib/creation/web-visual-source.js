import { parse } from "parse5";

const textTags = new Set("a abbr b blockquote button caption code dd dt em figcaption h1 h2 h3 h4 h5 h6 i label li p pre s small span strong sub summary sup td th time u".split(" "));
export const WEB_EDIT_ATTRIBUTE = "data-modelshot-edit-id";
const fail = code => { throw new Error(code); };

// Source offsets come from a real HTML parser, not a regex over nested HTML.
// Only explicit, text-only elements are offered: editing a parent must never
// flatten nested links, emphasis, images or other child elements.
export function createWebVisualSource(source) {
  if (typeof source !== "string" || source.length > 512 * 1024) fail("WEB_VISUAL_SOURCE_TOO_LARGE");
  // Reserved markers must originate here, including when fragment parsing
  // would move nodes out of head or repair invalid markup in the preview.
  if (/\bdata-modelshot-edit-id\b/i.test(source)) fail("WEB_VISUAL_MARKER_RESERVED");
  let invalid = false;
  const tree = parse(source, { sourceCodeLocationInfo: true, scriptingEnabled: false, onParseError: error => { if (error.code !== "missing-doctype") invalid = true; } });
  if (invalid) fail("WEB_VISUAL_MARKUP_INVALID");
  const targets = new Map(), ranges = new Set(); let count = 0;
  function walk(node, depth = 0, excluded = false) {
    if (++count > 20000 || depth > 100) fail("WEB_PREVIEW_COMPLEXITY_LIMIT");
    excluded ||= ["script", "style", "template", "noscript", "svg", "math", "head"].includes(node.tagName);
    const location = node.sourceCodeLocation;
    if (!excluded && textTags.has(node.tagName) && node.namespaceURI === "http://www.w3.org/1999/xhtml" && location?.startTag && location.endTag
      && node.childNodes?.length && node.childNodes.every(child => child.nodeName === "#text") && !ranges.has(location.startOffset)) {
      const text = node.childNodes.map(child => child.value).join("");
      if (text.trim() && text.length <= 16000) {
        const id = `text-${location.startOffset}`, style = node.attrs.find(attr => attr.name === "style");
        // Reject parser-repaired or duplicated source locations.
        if (location.startTag.endOffset <= location.endTag.startOffset && location.endTag.endOffset <= source.length) {
          ranges.add(location.startOffset);
          targets.set(id, { id, tag: node.tagName, text, style: style?.value || "", location });
          if (targets.size > 1000) fail("WEB_VISUAL_TARGET_LIMIT");
        }
      }
    }
    for (const child of node.childNodes || []) walk(child, depth + 1, excluded);
  }
  walk(tree);
  const insertions = [...targets.values()].map(target => ({ offset: target.location.startTag.startOffset + 1 + target.tag.length, text: ` ${WEB_EDIT_ATTRIBUTE}="${target.id}"` })).sort((a, b) => a.offset - b.offset);
  const parts = []; let position = 0;
  for (const insertion of insertions) { parts.push(source.slice(position, insertion.offset), insertion.text); position = insertion.offset; }
  parts.push(source.slice(position));
  const marked = parts.join("");
  return { source, marked, targets };
}
