export function clipboardImageFiles(clipboard) {
  const files = Array.from(clipboard?.files || []).filter(file => file.type.startsWith("image/"));
  if (files.length) return files;
  return Array.from(clipboard?.items || [])
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter(Boolean);
}

export function imagePasteDestination(target) {
  if (target?.closest?.('dialog, [role="dialog"]')) return null;
  if (target?.closest?.('[data-image-paste="reference"]')) return "reference";
  if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return null;
  return "canvas";
}
