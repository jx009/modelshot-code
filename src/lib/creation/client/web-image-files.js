import { validateNewWebPath } from "./web-files.js";
const fail = code => { throw new Error(code); };
const formats = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
function validateItem(item) {
  if (!item || typeof item.assetId !== "string" || !/^[a-zA-Z0-9_-]{16,64}$/.test(item.assetId) || !Object.hasOwn(formats, item.asset?.contentType || "")) fail("WEB_IMAGE_SELECTION_INVALID");
  return formats[item.asset.contentType];
}
export function prepareWebImageFiles(content, items, { target } = {}) {
  if (!Array.isArray(items) || !items.length || items.length > (target ? 1 : 8)) fail("WEB_IMAGE_SELECTION_INVALID");
  for (const item of items) validateItem(item);
  if (target) {
    const file = content.files.find(file => file.id === target.id && file.path === target.path && file.kind === "asset" && file.assetId === target.assetId);
    if (!file) fail("WEB_ASSET_CHANGED");
    const assetId = items[0].assetId;
    const retained = content.files.some(item => item.id !== file.id && item.assetId === file.assetId) ? content.assetIds : content.assetIds.filter(id => id !== file.assetId);
    if (!retained.includes(assetId) && retained.length >= 100) fail("WEB_ASSET_LIMIT");
    return { selectedId: file.id, operations: assetId === file.assetId ? [] : [{ op: "replaceAsset", fileId: file.id, path: file.path, expectedAssetId: file.assetId, assetId }] };
  }
  const staged = { ...content, files: [...content.files], assetIds: [...content.assetIds] }, operations = []; let selectedId;
  for (const item of items) {
    const existing = staged.files.find(file => file.kind === "asset" && file.assetId === item.assetId);
    if (existing) { selectedId ||= existing.id; continue; }
    if (staged.files.length >= 100) fail("WEB_SITE_TOO_LARGE");
    if (!staged.assetIds.includes(item.assetId) && staged.assetIds.length >= 100) fail("WEB_ASSET_LIMIT");
    const stem = `image-${item.assetId}`, extension = validateItem(item);
    let file;
    for (let suffix = 0; suffix <= 100; suffix++) {
      const id = suffix ? `${stem}-${suffix}` : stem, path = `${id}.${extension}`;
      if (staged.files.some(file => file.id === id)) continue;
      try { validateNewWebPath(staged, path, "asset"); }
      catch (error) { if (["WEB_DUPLICATE_FILE", "EXPORT_WEB_PATH_COLLISION"].includes(error.message)) continue; throw error; }
      file = { id, path, kind: "asset", assetId: item.assetId }; break;
    }
    if (!file) fail("WEB_DUPLICATE_FILE");
    operations.push({ op: "insertFile", file }); staged.files.push(file);
    if (!staged.assetIds.includes(file.assetId)) staged.assetIds.push(file.assetId);
    selectedId ||= file.id;
  }
  return { operations, selectedId };
}

export function webImageReference(assetPath, pagePath) {
  const base = pagePath.split("/").slice(0, -1), destination = assetPath.split("/"); let shared = 0;
  while (shared < base.length && shared < destination.length && base[shared] === destination[shared]) shared++;
  return [...base.slice(shared).map(() => ".."), ...destination.slice(shared)].join("/");
}
