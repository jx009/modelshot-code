import { webId } from "./contracts/web.js";

export function validateWebSelection(input, source) {
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  if (!source || source.kind !== "web") fail("LANGUAGE_SOURCE_MISMATCH");
  const { fileIds, paths } = input;
  if (!Array.isArray(fileIds) || !Array.isArray(paths) || !fileIds.length || fileIds.length > 20 || paths.length !== fileIds.length
    || new Set(fileIds).size !== fileIds.length || new Set(paths).size !== paths.length
    || fileIds.some(id => !webId.safeParse(id).success)) fail("LANGUAGE_SELECTION_CHANGED");
  const byId = new Map(source.files.map(file => [file.id, file]));
  const files = fileIds.map((id, index) => {
    const file = byId.get(id);
    if (!file || file.path !== paths[index]) fail("LANGUAGE_SELECTION_CHANGED");
    if (!["html", "css"].includes(file.kind)) fail("WEB_AGENT_JS_EDIT_DISABLED");
    return file;
  });
  return { files, byId: new Map(files.map(file => [file.id, file])) };
}
