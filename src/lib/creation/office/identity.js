// Shared with the save coordinator: no ZIP parser, Node imports or editor engine.
export function officeEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a).filter(k => a[k] !== undefined), other = Object.keys(b).filter(k => b[k] !== undefined);
  return keys.length === other.length && keys.every(k => Object.hasOwn(b, k) && officeEqual(a[k], b[k]));
}
export function officeImportMetadata(content) { return content?.snapshot?.custom?.modelshot?.officeImport || null; }
