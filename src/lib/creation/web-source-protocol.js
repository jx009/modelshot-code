export const WEB_SOURCE_CHANNEL = "modelshot-web-source-v1";
const fail = code => { throw new Error(code); };
const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const path = value => typeof value === "string" && value.length <= 240 && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(value) && !value.startsWith(".") && !value.includes("..");
function target(value) {
  if (!value || !id(value.id) || !path(value.path)) fail("WEB_SOURCE_WORKER_REQUEST_INVALID");
  return { id: value.id, path: value.path, ...(value.assetId === undefined ? {} : { assetId: value.assetId }) };
}
// Select only the fields used by parser tasks before structured cloning. This
// also bounds queue memory without JSON-stringifying whole documents on UI.
export function sourceTaskPayload(type, payload) {
  if (type === "visual") {
    if (typeof payload?.source !== "string" || payload.source.length > 512 * 1024) fail("WEB_VISUAL_SOURCE_TOO_LARGE");
    return { source: payload.source };
  }
  if (!["rename", "insertImage"].includes(type)) fail("WEB_SOURCE_WORKER_REQUEST_INVALID");
  const content = payload?.content;
  if (!content || !Array.isArray(content.files) || content.files.length > 100 || !path(content.entryPath)) fail("WEB_SOURCE_WORKER_REQUEST_INVALID");
  let characters = 0;
  const inputFiles = type === "insertImage" ? content.files.filter(file => file?.id === payload.target?.id || file?.id === payload.page?.id) : content.files;
  const files = inputFiles.map(file => {
    if (!file || !id(file.id) || !path(file.path) || !["html", "css", "js", "asset"].includes(file.kind)) fail("WEB_SOURCE_WORKER_REQUEST_INVALID");
    if (file.kind === "asset") {
      if (!id(file.assetId)) fail("WEB_SOURCE_WORKER_REQUEST_INVALID");
      return { id: file.id, path: file.path, kind: file.kind, assetId: file.assetId };
    }
    if (typeof file.content !== "string" || file.content.length > 512 * 1024) fail("WEB_REFERENCE_SOURCE_LIMIT");
    // Scripts are retained by the main document but never parsed or rewritten
    // here. Their contents are unnecessary for path collision checks.
    if (file.kind === "js") return { id: file.id, path: file.path, kind: file.kind, content: "" };
    characters += file.content.length;
    if (characters > 5 * 1024 * 1024) fail("WEB_REFERENCE_SOURCE_LIMIT");
    return { id: file.id, path: file.path, kind: file.kind, content: file.content };
  });
  const minimal = { entryPath: content.entryPath, files };
  if (type === "rename") {
    const request = payload.request;
    if (!request || !id(request.fileId) || !path(request.path) || !path(request.nextPath)) fail("WEB_SOURCE_WORKER_REQUEST_INVALID");
    return { content: minimal, request: { fileId: request.fileId, path: request.path, nextPath: request.nextPath } };
  }
  const image = target(payload.target), page = target(payload.page);
  if (!id(image.assetId)) fail("WEB_SOURCE_WORKER_REQUEST_INVALID");
  return { content: minimal, target: image, page: { id: page.id, path: page.path } };
}
