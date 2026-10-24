import { parse } from "parse5";
import { webImageReference } from "./web-image-files.js";
export function prepareWebImageInsertion(content, target, pageTarget) {
  const image = content.files.find(file => file.id === target.id && file.path === target.path && file.kind === "asset" && file.assetId === target.assetId);
  const page = content.files.find(file => file.id === pageTarget.id && file.path === pageTarget.path && file.kind === "html");
  if (!image) throw new Error("WEB_ASSET_CHANGED");
  if (!page) throw new Error("WEB_FILE_NOT_FOUND");
  if (page.content.length > 512 * 1024) throw new Error("WEB_REFERENCE_SOURCE_LIMIT");
  let invalid = false;
  const tree = parse(page.content, { sourceCodeLocationInfo: true, scriptingEnabled: false, onParseError: error => { if (error.code !== "missing-doctype") invalid = true; } });
  if (invalid) throw new Error("WEB_VISUAL_MARKUP_INVALID");
  const html = tree.childNodes.find(node => node.tagName === "html"), body = html?.childNodes.find(node => node.tagName === "body");
  if (!body) throw new Error("WEB_IMAGE_INSERT_UNSUPPORTED");
  // For implied body/html endings, EOF is the HTML parser's insertion point.
  // Explicit end tags let us preserve every existing source byte in place.
  const offset = body.sourceCodeLocation?.endTag?.startOffset ?? html.sourceCodeLocation?.endTag?.startOffset ?? page.content.length;
  const src = webImageReference(image.path, page.path);
  const markup = `\n<img src="${src}" alt="" loading="lazy" decoding="async" style="max-width:100%;height:auto">\n`;
  const next = page.content.slice(0, offset) + markup + page.content.slice(offset);
  if (next.length > 512 * 1024) throw new Error("WEB_REFERENCE_SOURCE_LIMIT");
  // Implicit closing tags can leave EOF inside a table, paragraph or template.
  // Verify the actual parser placement rather than silently inserting there.
  const check = parse(next, { sourceCodeLocationInfo: true, scriptingEnabled: false });
  const nextBody = check.childNodes.find(node => node.tagName === "html")?.childNodes.find(node => node.tagName === "body");
  if (!nextBody?.childNodes.some(node => node.tagName === "img" && node.sourceCodeLocation?.startOffset === offset + 1)) throw new Error("WEB_IMAGE_INSERT_UNSUPPORTED");
  return { operations: [{ op: "setFile", fileId: page.id, path: page.path, kind: "html", content: next }], selectedId: page.id };
}
