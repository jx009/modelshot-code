import { webSchema } from "./contracts/web.js";
import { webResourcePath } from "./web-resource-path.js";

const raster = value => typeof value === "string" && value.length <= 1500000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
const MAX_PREVIEW_CHARACTERS = 12 * 1024 * 1024;

// Browser-only preview builder. Interactive previews run only in an opaque,
// sandboxed iframe with a deny-by-default CSP; they never inherit app origin.
const tags = new Set("a abbr article aside b blockquote br button caption code col colgroup dd details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img label li main nav ol p pre s section small span strong sub summary sup table tbody td th thead time tr u ul".split(" "));
const attributes = new Set(["id", "class", "title", "alt", "width", "height", "colspan", "rowspan", "scope", "open", "role", "dir", "lang"]);
const interactiveTags = new Set("form input select option optgroup textarea fieldset legend output progress meter".split(" "));
const interactiveAttributes = new Set("name type value placeholder checked selected disabled readonly required multiple min max step minlength maxlength for autocomplete rows cols label".split(" "));
const staticCsp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const interactiveCsp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' data:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const MAX_PREVIEW_SCRIPTS = 20;
const svgTags = new Set("svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask title desc use".split(" "));
const svgAttributes = new Set("id class viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin fill-rule clip-rule opacity fill-opacity stroke-opacity transform offset stop-color stop-opacity gradientUnits gradientTransform preserveAspectRatio text-anchor font-size font-family clip-path mask".split(" "));
export function prepareWebPreviewDocument(input, { editing, interactive = false, rootEntryPath, prepareModules } = {}) {
  const site = webSchema.parse(input);
  if (typeof document === "undefined") throw new Error("WEB_PREVIEW_BROWSER_REQUIRED");
  // Template contents stay inert while parsing, including resource elements.
  const template = document.createElement("template");
  const entryContent = site.files.find(file => file.path === site.entryPath).content;
  if (editing && editing.source !== entryContent) throw new Error("WEB_SOURCE_CHANGED");
  template.innerHTML = editing ? editing.marked : entryContent;
  const output = document.implementation.createHTMLDocument(site.title);
  const resources = new Map(site.files.filter(file => file.kind === "asset" && site.assetIds.includes(file.assetId)).map(file => [file.path, file.assetId]));
  const assetIds = new Set(), bindings = [], editableIds = new Set(), scripts = [], moduleEntries = [], jsFiles = new Map(site.files.filter(file => file.kind === "js").map(file => [file.path, file.content]));
  let expanded = 0;
  const charge = value => { expanded += value.length; if (expanded > MAX_PREVIEW_CHARACTERS) throw new Error("WEB_PREVIEW_ASSET_LIMIT"); };
  const resolve = (value, fromPath) => {
    const id = resources.get(webResourcePath(value, fromPath));
    if (id) { assetIds.add(id); if (assetIds.size > 20) throw new Error("WEB_PREVIEW_ASSET_LIMIT"); }
    return id;
  };
  // Resolve CSS relative to its own file, HTML styles relative to the page.
  // Noncanonical/escaped URLs remain blocked by CSP; they are not fetched.
  function cssBinding(value, fromPath, apply) {
    const refs = [];
    value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"\\]*))\s*\)/gi, (match, quoted, single, bare, offset) => {
      const url = quoted ?? single ?? bare;
      refs.push({ start: offset, end: offset + match.length, value: raster(url) ? url : null, id: resolve(url, fromPath) });
      return match;
    });
    bindings.push(images => {
      let result = "", position = 0;
      for (const ref of refs) {
        const url = ref.value || images.get(ref.id);
        result += value.slice(position, ref.start) + (raster(url) ? `url("${url}")` : 'url("")'); position = ref.end;
        if (result.length > MAX_PREVIEW_CHARACTERS) throw new Error("WEB_PREVIEW_ASSET_LIMIT");
      }
      result += value.slice(position); charge(result); apply(result);
    });
  }
  const policy = output.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy"; policy.content = interactive ? interactiveCsp : staticCsp;
  output.head.prepend(policy);
  const charset = output.createElement("meta"); charset.setAttribute("charset", "utf-8"); output.head.prepend(charset);
  const viewport = output.createElement("meta"); viewport.name = "viewport"; viewport.content = "width=device-width, initial-scale=1"; output.head.append(viewport);
  const addStyle = (value, fromPath) => {
    const node = output.createElement("style"); output.head.append(node);
    cssBinding(value, fromPath, css => { node.textContent = css.replace(/</g, "\\3c "); });
  };
  const stylesheets = new Map(site.files.filter(file => file.kind === "css").map(file => [file.path, file]));
  const includedStyles = new Set();
  let count = 0;
  function copy(node, parent, depth = 0) {
    if (++count > 20000 || depth > 100) throw new Error("WEB_PREVIEW_COMPLEXITY_LIMIT");
    if (node.nodeType === 3) { parent.append(output.createTextNode(node.textContent)); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (node.namespaceURI === "http://www.w3.org/2000/svg") {
      if (!svgTags.has(tag)) return;
      const element = output.createElementNS(node.namespaceURI, tag);
      for (const attr of node.attributes) {
        if (svgAttributes.has(attr.name) && !/url\(/i.test(attr.value)) element.setAttribute(attr.name, attr.value);
        else if (svgAttributes.has(attr.name) && /^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value)) element.setAttribute(attr.name, attr.value);
        else if (["href", "xlink:href"].includes(attr.name) && /^#[a-zA-Z0-9_-]+$/.test(attr.value)) element.setAttribute("href", attr.value);
      }
      parent.append(element);
      for (const child of node.childNodes) copy(child, element, depth + 1);
      return;
    }
    if (tag === "script") {
      if (interactive) {
        const type = node.getAttribute("type")?.trim().toLowerCase();
        if (type === "module") {
          const src = node.getAttribute("src");
          moduleEntries.push(src ? { src: webResourcePath(src, site.entryPath) } : { code: node.textContent });
          if (moduleEntries.length > MAX_PREVIEW_SCRIPTS) throw new Error("WEB_PREVIEW_SCRIPT_LIMIT");
        } else if (!type || ["text/javascript", "application/javascript"].includes(type)) {
          const src = node.getAttribute("src");
          if (src) {
            const path = webResourcePath(src, site.entryPath), code = jsFiles.get(path);
            if (code !== undefined) scripts.push(code);
          } else if (node.textContent.length <= 512 * 1024) scripts.push(node.textContent);
          if (scripts.length > MAX_PREVIEW_SCRIPTS) throw new Error("WEB_PREVIEW_SCRIPT_LIMIT");
        }
      }
      return;
    }
    if (tag === "link") {
      const path = webResourcePath(node.getAttribute("href"), site.entryPath), stylesheet = stylesheets.get(path);
      if (node.namespaceURI === "http://www.w3.org/1999/xhtml" && node.getAttribute("rel")?.toLowerCase().split(/\s+/).includes("stylesheet") && stylesheet && !includedStyles.has(path)) {
        includedStyles.add(path); addStyle(stylesheet.content, stylesheet.path);
      }
      return;
    }
    if (tag === "style") { addStyle(node.textContent, site.entryPath); return; }
    if (node.namespaceURI !== "http://www.w3.org/1999/xhtml" || !tags.has(tag) && !(interactive && interactiveTags.has(tag))) return;
    const element = output.createElement(tag);
    if (editing) {
      const id = node.getAttribute("data-modelshot-edit-id"), target = editing.targets.get(id);
      if (target && target.tag === tag && node.textContent === target.text && !node.children.length) { element.setAttribute("data-modelshot-edit-id", id); editableIds.add(id); }
    }
    for (const attr of node.attributes) {
      if (attributes.has(attr.name) || /^aria-[a-z-]+$/.test(attr.name)) element.setAttribute(attr.name, attr.value);
      if (interactive && (interactiveAttributes.has(attr.name) || /^data-[a-z0-9_-]+$/.test(attr.name))) element.setAttribute(attr.name, attr.value);
      if (interactive && tag === "a" && attr.name === "href") {
        if (/^#[a-zA-Z0-9_-]*$/.test(attr.value)) element.setAttribute("href", attr.value);
        else {
          const path = attr.value === "/" ? rootEntryPath || input.entryPath : webResourcePath(attr.value, site.entryPath);
          if (site.files.some(file => file.path === path && file.kind === "html")) {
            element.setAttribute("href", "#"); element.setAttribute("data-cw-preview-path", path);
          }
        }
      }
      if (attr.name === "style") cssBinding(attr.value, site.entryPath, css => element.setAttribute("style", css));
      // The parent resolves private assets. The sandbox receives raster bytes,
      // never an authenticated endpoint, CDN token, or arbitrary resource URL.
      if (tag === "img" && attr.name === "src") {
        const id = resolve(attr.value, site.entryPath), inline = raster(attr.value) ? attr.value : null;
        bindings.push(images => {
          const url = inline || images.get(id);
          if (raster(url)) { charge(url); element.setAttribute("src", url); } else element.removeAttribute("src");
        });
        element.setAttribute("loading", "lazy"); element.setAttribute("decoding", "async");
      }
    }
    if (tag === "button" && !interactive) element.setAttribute("type", "button");
    parent.append(element);
    for (const child of node.childNodes) copy(child, element, depth + 1);
  }
  for (const node of template.content.childNodes) copy(node, output.body);
  // Install once: render() may be called again with refreshed image bytes.
  // HTML serialization does not escape script raw text, so protect its closing
  // delimiter without changing the JS string/template value seen at runtime.
  if (interactive) for (const code of scripts) {
    const script = output.createElement("script");
    script.textContent = code.replace(/<\/script/gi, match => `<\\${match.slice(1)}`);
    output.body.append(script);
  }
  if (interactive && moduleEntries.length) {
    if (!prepareModules) throw new Error("WEB_MODULE_COMPILER_REQUIRED");
    const modules = prepareModules(site, moduleEntries), map = output.createElement("script");
    map.type = "importmap"; map.textContent = JSON.stringify({ imports: modules.imports }).replace(/</g, "\\u003c");
    output.head.append(map);
    for (const code of modules.roots) {
      const script = output.createElement("script"); script.type = "module";
      script.textContent = code.replace(/<\/script/gi, match => `<\\${match.slice(1)}`); output.body.append(script);
    }
  }
  return {
    assetIds: [...assetIds],
    editableIds: [...editableIds],
    render(images = new Map()) {
      expanded = 0;
      for (const bind of bindings) bind(images);
      const html = `<!doctype html>${output.documentElement.outerHTML}`;
      if (html.length > MAX_PREVIEW_CHARACTERS) throw new Error("WEB_PREVIEW_ASSET_LIMIT");
      return html;
    },
  };
}
export function buildWebPreviewDocument(input, images, options) { return prepareWebPreviewDocument(input, options).render(images); }
export function webPreviewFrameProps(site) {
  return { sandbox: "", referrerPolicy: "no-referrer", title: site.title, srcDoc: buildWebPreviewDocument(site) };
}
export function validateWebPreviewMessage(event, { source, origin = "null", maxBytes = 16 * 1024 } = {}) {
  const reject = () => { throw new Error("WEB_PREVIEW_MESSAGE_REJECTED"); };
  if (!source || !event || event.source !== source || event.origin !== origin || origin !== "null" || !event.data || typeof event.data !== "object") reject();
  const data = event.data;
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength; } catch { reject(); }
  if (data.channel !== "modelshot-web-preview-v1" || data.type !== "ready" || bytes > maxBytes
    || Object.keys(data).some(key => !["channel", "type", "payload"].includes(key))) reject();
  const payload = data.payload;
  if (!payload || typeof payload !== "object" || Object.keys(payload).some(key => !["width", "height"].includes(key))
    || !Number.isInteger(payload.width) || payload.width < 1 || payload.width > 8192
    || payload.height !== undefined && (!Number.isInteger(payload.height) || payload.height < 1 || payload.height > 32768)) reject();
  return { channel: data.channel, type: data.type, payload: { width: payload.width, ...(payload.height === undefined ? {} : { height: payload.height }) } };
}
