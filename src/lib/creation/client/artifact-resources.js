import { inspectHtml } from "../html/document.js";

const cached = new WeakMap();
// The source document has already passed the artifact schema. Extract only
// stored asset references; do not infer filenames or create phantom files.
export function artifactResources(artifactId, content) {
  const resources = [], seen = new Set();
  if (content?.schemaVersion !== 3) return { artifactId, images: [], design: "" };
  for (const page of [...content.pages, ...(content.masters || [])]) {
    let ids = cached.get(page);
    if (!ids) {
      ids = inspectHtml((page.css ? "<style>" + page.css + "</style>" : "") + (page.html || "<body></body>"), { allowEmpty: true }).assets;
      cached.set(page, ids);
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id); resources.push({ id, pageTitle: page.title || page.name || "" });
    }
  }
  return { artifactId, images: resources, design: typeof content.metadata?.designMarkdown === "string" ? content.metadata.designMarkdown : "" };
}
