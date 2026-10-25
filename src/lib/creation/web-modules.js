import { parse } from "acorn";
import { webResourcePath } from "./web-resource-path.js";

// Parse source ranges, never rewrite string literals/comments that happen to
// contain a filename. Used only by explicit preview/export/rename operations.
export function rewriteModuleReferences(source, rewrite) {
  let tree;
  try { tree = parse(source, { ecmaVersion: "latest", sourceType: "module" }); }
  catch { throw new Error("WEB_MODULE_SYNTAX_INVALID"); }
  const edits = [];
  for (const node of tree.body) {
    if (!["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) || !node.source) continue;
    const value = rewrite(node.source.value);
    if (value !== node.source.value) edits.push({ start: node.source.start, end: node.source.end, value: JSON.stringify(value) });
  }
  let result = source;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return result;
}

export function preparePreviewModules(site, entries) {
  const files = new Map(site.files.filter(file => file.kind === "js").map(file => [file.path, file.content]));
  const ids = new Map(), imports = {}, pending = [];
  const register = path => {
    if (!files.has(path)) throw new Error("WEB_MODULE_REFERENCE_NOT_FOUND");
    if (!ids.has(path)) { ids.set(path, `cw-module-${ids.size}`); pending.push(path); }
    return ids.get(path);
  };
  const rewrite = from => reference => {
    if (!reference.startsWith(".") && !reference.startsWith("/") || /[?#]/.test(reference)) throw new Error("WEB_MODULE_REFERENCE_NOT_FOUND");
    return register(webResourcePath(reference, from));
  };
  const roots = entries.map(entry => entry.src ? `import ${JSON.stringify(register(entry.src))};` : rewriteModuleReferences(entry.code, rewrite(site.entryPath)));
  // Assign stable identities before traversing dependencies, including cycles.
  for (let i = 0; i < pending.length; i++) {
    const path = pending[i], code = rewriteModuleReferences(files.get(path), rewrite(path));
    imports[ids.get(path)] = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  }
  return { imports, roots };
}
