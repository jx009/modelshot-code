// Keystrokes preserve only one file's source, including temporarily invalid code.
export function pendingWebSourceSnapshot(value) {
  if (value == null) return null;
  if (value.kind !== "web-source" || typeof value.fileId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.fileId)
    || typeof value.path !== "string" || value.path.length > 240 || !["html", "css", "js"].includes(value.fileKind)
    || ![value.original, value.text].every(text => typeof text === "string" && text.length <= 512 * 1024)) throw new Error("WEB_SOURCE_DRAFT_INVALID");
  return { kind: "web-source", fileId: value.fileId, path: value.path, fileKind: value.fileKind, original: value.original, text: value.text, composing: Boolean(value.composing) };
}
export function pendingWebSourceOperations(content, value) {
  const draft = pendingWebSourceSnapshot(value);
  if (!draft) return [];
  if (draft.composing) throw new Error("TEXT_COMPOSITION_ACTIVE");
  const file = content?.kind === "web" && content.files.find(file => file.id === draft.fileId);
  if (!file || file.path !== draft.path || file.kind !== draft.fileKind || file.content !== draft.original && file.content !== draft.text) throw new Error("WEB_SOURCE_CHANGED");
  return file.content === draft.text ? [] : [{ op: "setFile", fileId: file.id, path: file.path, kind: file.kind, content: draft.text }];
}
