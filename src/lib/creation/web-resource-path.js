// Resolve only paths within the generated file tree, never a network URL.
export function webResourcePath(reference, fromPath) {
  if (typeof reference !== "string" || !reference || reference.startsWith("//") || /[:\\%\x00-\x20]/.test(reference)) return null;
  const path = reference.split(/[?#]/, 1)[0];
  if (!path || !/^[a-zA-Z0-9_./-]+$/.test(path)) return null;
  const segments = path.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!segments.length) return null; segments.pop(); }
    else segments.push(part);
  }
  return segments.join("/") || null;
}
