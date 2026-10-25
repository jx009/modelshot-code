import { rewriteModuleReferences } from "./web-modules.js";
import { webResourcePath } from "./web-resource-path.js";
import { rewriteCssReferences } from "./web-reference-css.js";
import { rewriteHtmlReferences } from "./web-reference-html.js";

// ZIPs and hosted revisions use exactly the same portable relative references.
// Source-range edits preserve scripts, whitespace and unrelated markup.
export function webDeploymentSource(file, site) {
  if (!["html", "css", "js"].includes(file.kind)) return file.content;
  const paths = new Set(site.files.map(item => item.path));
  const rewrite = reference => {
    const value = reference.trim();
    if (!value || /^[?#]/.test(value)) return reference;
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) || /^(?:mailto|tel):[^\s<>]+$/i.test(value)) return reference;
    // Never publish signed image URLs or authenticated app endpoints as source.
    // Files must bind images through owned assets and portable local paths.
    if (value.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) throw new Error("WEB_EXTERNAL_REFERENCE_UNSUPPORTED");
    const suffixAt = value.search(/[?#]/), pathname = suffixAt < 0 ? value : value.slice(0, suffixAt);
    const suffix = suffixAt < 0 ? "" : value.slice(suffixAt);
    const decoded = pathname.replace(/%([a-fA-F0-9]{2})/g, (match, hex) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return /[a-zA-Z0-9_.-]/.test(char) ? char : match;
    });
    let target = decoded === "/" ? site.entryPath : webResourcePath(decoded, file.path);
    if (target && !paths.has(target) && paths.has(`${target}/index.html`)) target += "/index.html";
    if (!target || !paths.has(target)) throw new Error("WEB_REFERENCE_NOT_FOUND");
    const from = file.path.split("/").slice(0, -1), to = target.split("/");
    let shared = 0;
    while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
    const relative = [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
    return relative + suffix;
  };
  const moduleRewrite = reference => { const value = rewrite(reference); return value.startsWith(".") ? value : `./${value}`; };
  if (file.kind === "js") return rewriteModuleReferences(file.content, moduleRewrite);
  return file.kind === "html" ? rewriteHtmlReferences(file.content, rewrite, undefined, moduleRewrite) : rewriteCssReferences(file.content, rewrite);
}
