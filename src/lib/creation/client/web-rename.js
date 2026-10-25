import { rewriteModuleReferences } from "../web-modules.js";
import { rewriteHtmlReferences } from "../web-reference-html.js";
import { webResourcePath } from "../web-resource-path.js";
import { rewriteCssReferences } from "../web-reference-css.js";
import { validateNewWebPath } from "./web-files.js";

const fail = code => { throw new Error(code); };
function relativePath(from, destination) {
  const base = from.split("/").slice(0, -1), target = destination.split("/");
  let shared = 0;
  while (shared < base.length && shared < target.length && base[shared] === target[shared]) shared++;
  return [...base.slice(shared).map(() => ".."), ...target.slice(shared)].join("/") || "./";
}
export function webReferenceRewrite(reference, from, nextFrom, oldPath, nextPath) {
  const value = reference.trim();
  if (!value || value.startsWith("#") || value.startsWith("?") || value === "/" || value.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return reference;
  const suffixAt = value.search(/[?#]/), pathname = suffixAt < 0 ? value : value.slice(0, suffixAt), suffix = suffixAt < 0 ? "" : value.slice(suffixAt);
  if (pathname === "/") return reference;
  // Only URL-encoded unreserved characters can name our portable files. Do
  // not reinterpret encoded slashes, backslashes or arbitrary URL syntax.
  let decoded = pathname;
  try { decoded = pathname.replace(/%([a-fA-F0-9]{2})/g, (_match, hex) => { const char = String.fromCharCode(parseInt(hex, 16)); if (!/[a-zA-Z0-9_.-]/.test(char)) fail("WEB_REFERENCE_PATH_UNSUPPORTED"); return char; }); }
  catch { fail("WEB_REFERENCE_PATH_UNSUPPORTED"); }
  const destination = webResourcePath(decoded, from);
  if (!destination) fail("WEB_REFERENCE_PATH_UNSUPPORTED");
  const nextDestination = destination === oldPath ? nextPath : destination;
  const sameDirectory = from.split("/").slice(0, -1).join("/") === nextFrom.split("/").slice(0, -1).join("/");
  if (nextDestination === destination && (sameDirectory || pathname.startsWith("/"))) return reference;
  let next = pathname.startsWith("/") ? `/${nextDestination}` : relativePath(nextFrom, nextDestination);
  if (pathname.endsWith("/") && !next.endsWith("/")) next += "/";
  return reference.replace(value, next + suffix);
}
// Parse only on explicit rename. Yield between files so unrelated app work
// can run; never rebuild this plan on every filename keystroke.
export async function prepareWebRename(content, request, { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const check = () => { if (signal?.aborted) fail("ARTIFACT_CLOSED"); };
  check();
  const file = content.files.find(file => file.id === request.fileId && file.path === request.path);
  if (!file) fail("WEB_FILE_NOT_FOUND");
  const nextPath = request.nextPath;
  if (nextPath === file.path) return { operations: [], selectedId: file.id };
  validateNewWebPath({ ...content, files: content.files.filter(item => item.id !== file.id) }, nextPath, file.kind);
  const updates = [], budget = { nodes: 0 }; let characters = 0;
  for (const source of content.files) {
    if (!["html", "css", "js"].includes(source.kind)) continue;
    await yieldControl(); check();
    characters += source.content.length;
    if (source.content.length > 512 * 1024 || characters > 5 * 1024 * 1024) fail("WEB_REFERENCE_SOURCE_LIMIT");
    const rewrite = value => webReferenceRewrite(value, source.path, source.id === file.id ? nextPath : source.path, file.path, nextPath);
    const moduleRewrite = value => { const next = rewrite(value); return next.startsWith(".") || next.startsWith("/") ? next : `./${next}`; };
    const next = source.kind === "html" ? rewriteHtmlReferences(source.content, rewrite, budget, moduleRewrite) : source.kind === "js" ? rewriteModuleReferences(source.content, moduleRewrite) : rewriteCssReferences(source.content, rewrite);
    if (next !== source.content) updates.push({ fileId: source.id, path: source.path, kind: source.kind, content: next });
  }
  check();
  return { operations: [{ op: "renameFile", fileId: file.id, path: file.path, nextPath, ...(updates.length ? { updates } : {}) }], selectedId: file.id };
}
