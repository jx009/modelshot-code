import { webSchema, webOperationsSchema } from "./contracts/web.js";
export class WebOperationError extends Error { constructor(code) { super(code); this.name = "WebOperationError"; this.code = code; } }
const fail = code => { throw new WebOperationError(code); };
export function applyWebOperations(input, inputOperations) {
  return apply(input, inputOperations, false).document;
}
export function applyWebOperationsWithInverse(input, inputOperations) {
  return apply(input, inputOperations, true);
}
function apply(input, inputOperations, withInverse) {
  const site = webSchema.parse(input), operations = webOperationsSchema.parse(inputOperations);
  let current = site;
  const inverse = [], record = (...items) => { if (withInverse) inverse.unshift(...items); };
  for (const operation of operations) {
    if (operation.op === "setTheme") { record({ op: "setTheme", theme: current.theme }); current = { ...current, theme: operation.theme }; }
    else if (operation.op === "setAssetIds") { record({ op: "setAssetIds", assetIds: current.assetIds }); current = { ...current, assetIds: operation.assetIds }; }
    else if (operation.op === "setEntry") {
      const file = current.files.find(item => item.path === operation.path);
      if (!file || file.kind !== "html") fail("WEB_ENTRY_INVALID"); record({ op: "setEntry", path: current.entryPath }); current = { ...current, entryPath: operation.path };
    } else if (operation.op === "insertFile") {
      if (current.files.some(file => file.id === operation.file.id || file.path === operation.file.path)) fail("WEB_DUPLICATE_FILE");
      const index = operation.index ?? current.files.length;
      if (index > current.files.length) fail("WEB_FILE_POSITION_INVALID");
      const addsAsset = operation.file.assetId && !current.assetIds.includes(operation.file.assetId);
      record({ op: "removeFile", fileId: operation.file.id, path: operation.file.path }, ...(addsAsset ? [{ op: "setAssetIds", assetIds: current.assetIds }] : []));
      const files = [...current.files]; files.splice(index, 0, operation.file);
      current = { ...current, files, assetIds: addsAsset ? [...current.assetIds, operation.file.assetId] : current.assetIds };
    } else {
      const index = current.files.findIndex(file => file.id === operation.fileId && file.path === operation.path);
      if (index < 0) fail("WEB_FILE_NOT_FOUND");
      const file = current.files[index];
      if (operation.op === "replaceAsset") {
        if (file.kind !== "asset" || file.assetId !== operation.expectedAssetId) fail("WEB_ASSET_CHANGED");
        record({ op: "replaceAsset", fileId: file.id, path: file.path, expectedAssetId: operation.assetId, assetId: file.assetId, assetIds: current.assetIds });
        const retained = current.files.some(item => item.id !== file.id && item.assetId === file.assetId) ? current.assetIds : current.assetIds.filter(id => id !== file.assetId);
        const assetIds = operation.assetIds || (retained.includes(operation.assetId) ? retained : [...retained, operation.assetId]);
        current = { ...current, assetIds, files: current.files.map((item, itemIndex) => itemIndex === index ? { ...item, assetId: operation.assetId } : item) };
      } else if (operation.op === "removeFile") {
        if (file.path === current.entryPath) fail("WEB_ENTRY_INVALID");
        record({ op: "insertFile", file, index });
        current = { ...current, files: current.files.filter((_, itemIndex) => itemIndex !== index) };
      } else if (operation.op === "renameFile") {
        if (current.files.some((item, itemIndex) => itemIndex !== index && item.path === operation.nextPath)) fail("WEB_DUPLICATE_FILE");
        const updates = new Map(), originals = [], byId = new Map(current.files.map(item => [item.id, item]));
        for (const update of operation.updates || []) {
          const original = byId.get(update.fileId);
          if (!original || original.path !== update.path || original.kind !== update.kind || updates.has(update.fileId)) fail("WEB_FILE_NOT_FOUND");
          updates.set(update.fileId, update.content);
          originals.push({ fileId: original.id, path: original.id === file.id ? operation.nextPath : original.path, kind: original.kind, content: original.content });
        }
        record({ op: "renameFile", fileId: file.id, path: operation.nextPath, nextPath: file.path, ...(originals.length ? { updates: originals } : {}) });
        // Path and source references travel as one journal operation. Splitting
        // them into independent setFile requests can publish broken links.
        current = { ...current, files: current.files.map(item => ({ ...item, ...(updates.has(item.id) ? { content: updates.get(item.id) } : {}), ...(item.id === file.id ? { path: operation.nextPath } : {}) })), entryPath: current.entryPath === file.path ? operation.nextPath : current.entryPath };
      } else {
        if (file.kind !== operation.kind) fail("WEB_FILE_KIND_CHANGED");
        record({ ...operation, content: file.content });
        current = { ...current, files: current.files.map((item, itemIndex) => itemIndex === index ? { ...item, content: operation.content } : item) };
      }
    }
  }
  // Validate the final state once. Re-parsing every unchanged file after each
  // operation makes a 100-operation batch scan and clone the site 100 times.
  if (inverse.length > 100) fail("WEB_UNDO_BATCH_TOO_LARGE");
  return { document: webSchema.parse(current), inverse };
}
