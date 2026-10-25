import { parse } from "parse5";
import { rewriteCssReferences } from "./web-reference-css.js";
import { webResourcePath } from "./web-resource-path.js";

export const webDesignGuide = `Design a cohesive, responsive website for the actual audience and goal. Before files, return design:{audience,concept,typography,layout,interactions}, each a concise string (<=1200 chars). Define a distinctive visual direction, type hierarchy, spacing rhythm, page roles and useful local interactions. Apply that same design system to every page with shared CSS variables and consistent navigation/footer. Prefer a strong editorial hero and varied content sections over repeated generic rounded card grids. Use supplied assets deliberately, preserving aspect ratio; without assets use purposeful CSS/SVG graphics and typography, never broken image placeholders.
Use semantic header/nav/main/section/footer, one clear h1 per page and structured heading levels. Copy should answer real visitor questions using only supplied facts; do not invent testimonials, customer logos or statistics. Build a useful primary action, not a decorative button. Local navigation must target actual HTML files or existing fragment IDs. Use details/summary for simple FAQ; use bounded local DOM handlers for tabs, filtering or mobile-menu toggles when needed. Mark forms as a local demo with honest feedback, never pretend a server received data.
Use fluid widths, a sensible max-width, clamp() typography and responsive grid/flex. Every HTML page needs a viewport meta tag. Check desktop 1440 and mobile 390 layouts: stack columns naturally, preserve readable text and tap targets, avoid horizontal overflow, and implement a working keyboard-accessible mobile menu. Explicit foreground/background colors must remain legible independent of the editor theme. Honor reduced-motion preferences; avoid continuous heavyweight animation, huge blur effects and blocking splash screens.
Before returning, audit all file links: CSS, JS, image paths and navigation destinations must exist in files, resolve from the containing file, and be explicitly linked where used. A separate CSS/JS file is ineffective unless referenced. Keep all layout/content editable. Do not invent framework imports, CDN resources or backend endpoints.`;

// Check references before publishing a paid result. The existing preview
// remains the security boundary; this check prevents silently missing assets.
export function validateGeneratedWebReferences(site) {
  const paths = new Set(site.files.map(file => file.path));
  let nodes = 0;
  for (const file of site.files) {
    const check = value => {
      if (!value || value.startsWith("#") || value.startsWith("?")) return value;
      // Inline raster images already supported by the isolated preview.
      if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
      const path = webResourcePath(value, file.path);
      if (!path || !paths.has(path)) throw new Error("LANGUAGE_WEB_MISMATCH");
      return value;
    };
    if (file.kind === "html") {
      const walk = (node, depth = 0) => {
        if (++nodes > 100000 || depth > 100) throw new Error("LANGUAGE_WEB_MISMATCH");
        for (const attr of node.attrs || []) {
          if (["href", "src", "poster", "action", "formaction"].includes(attr.name)) check(attr.value);
          if (attr.name === "style") rewriteCssReferences(attr.value, check);
        }
        if (node.tagName === "style") rewriteCssReferences((node.childNodes || []).map(child => child.value || "").join(""), check);
        for (const child of node.childNodes || []) walk(child, depth + 1);
        if (node.content) walk(node.content, depth + 1);
      };
      walk(parse(file.content));
    }
    if (file.kind === "css") rewriteCssReferences(file.content, check);
  }
  return site;
}
