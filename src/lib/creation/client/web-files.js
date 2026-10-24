import { webFileSchema } from "../contracts/web.js";

const fail = code => { throw new Error(code); };
const extensions = { html: ["html", "htm"], css: ["css"], js: ["js", "mjs"], asset: ["png", "jpg", "jpeg", "webp"] };
// Apply portable naming rules when the user creates files, so the ZIP exporter
// will not later discover a case collision or a Windows device filename.
export function validateNewWebPath(content, path, kind) {
  if (typeof path !== "string" || path.length > 240 || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(path) || path.startsWith(".") || path.includes("..")) fail("WEB_PATH_INVALID");
  if (path.split("/").some(part => part.endsWith(".") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail("EXPORT_WEB_PATH_UNSUPPORTED");
  if (!extensions[kind]?.includes(path.split(".").at(-1).toLowerCase())) fail("EXPORT_WEB_EXTENSION_UNSUPPORTED");
  const lower = path.toLowerCase(), segments = path.split("/");
  for (const file of content.files) {
    const existing = file.path.toLowerCase();
    if (existing === lower || existing.startsWith(`${lower}/`) || lower.startsWith(`${existing}/`)) fail("WEB_DUPLICATE_FILE");
    const other = file.path.split("/");
    for (let index = 0; index < Math.min(segments.length - 1, other.length - 1); index++) {
      if (segments[index].toLowerCase() !== other[index].toLowerCase()) break;
      if (segments[index] !== other[index]) fail("EXPORT_WEB_PATH_COLLISION");
    }
  }
  return path;
}
export function suggestedWebPath(content, file) {
  const path = file?.path || "page.html", dot = path.lastIndexOf("."), base = dot >= 0 ? path.slice(0, dot) : path, extension = dot >= 0 ? path.slice(dot) : ".html";
  const used = new Set(content.files.map(item => item.path.toLowerCase()));
  for (let suffix = 1; suffix <= 101; suffix++) {
    const candidate = `${base}-${file ? "copy" : "new"}${suffix === 1 ? "" : `-${suffix}`}${extension}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  fail("WEB_SITE_TOO_LARGE");
}
export function webFileAction(content, request) {
  const { action, fileId, path, nextPath, kind, newId, zh = true } = request;
  const file = content.files.find(file => file.id === fileId && file.path === path);
  if (action !== "create" && !file) fail("WEB_FILE_NOT_FOUND");
  if (action === "entry") {
    if (file.kind !== "html") fail("WEB_ENTRY_INVALID");
    return { operations: [{ op: "setEntry", path: file.path }], selectedId: file.id };
  }
  if (action === "delete") {
    if (file.path === content.entryPath) fail("WEB_ENTRY_INVALID");
    return { operations: [{ op: "removeFile", fileId: file.id, path: file.path }], selectedId: content.files.find(item => item.path === content.entryPath).id };
  }
  if (!["create", "duplicate"].includes(action)) fail("WEB_FILE_ACTION_INVALID");
  const fileKind = file?.kind || kind;
  if (action === "create" && !["html", "css", "js"].includes(fileKind)) fail("WEB_FILE_ACTION_INVALID");
  if (content.files.length >= 100 || fileKind === "html" && content.files.filter(item => item.kind === "html").length >= 20) fail("WEB_SITE_TOO_LARGE");
  validateNewWebPath(content, nextPath, fileKind);
  const title = zh ? "新页面" : "New page";
  const starter = fileKind === "html" ? `<!doctype html>\n<html lang="${zh ? "zh-CN" : "en"}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${title}</title>\n</head>\n<body>\n  <main>\n    <h1>${title}</h1>\n  </main>\n</body>\n</html>\n` : `/* ${zh ? "在这里编写代码" : "Write your code here"} */\n`;
  const next = webFileSchema.parse(file ? { ...file, id: newId, path: nextPath } : { id: newId, path: nextPath, kind: fileKind, content: starter });
  return { operations: [{ op: "insertFile", file: next }], selectedId: next.id };
}
