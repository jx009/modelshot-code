import { randomUUID } from "node:crypto";
import { officePackage, officeFail } from "./package.js";
import { children, descendants as xmlDescendants, attribute, textContent } from "../references/office-xml.js";
import { htmlDocumentSchema, inspectHtml } from "../html/document.js";
import { officeImportBytes, PPTX_MEDIA_COUNT } from "./import-policy.js";

const EMU = 914400, PX = 96;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const attr = (node, name) => node ? attribute(node, name) : undefined;
const child = (node, ns, name) => children(node, ns, name)[0];
// Chart titles, categories and placeholder properties are optional in OOXML.
const descendants = (node, ns, name) => node ? xmlDescendants(node, ns, name) : [];
const id = () => `ppt_${randomUUID().replaceAll("-", "")}`;
const px = value => Math.round(Number(value || 0) / EMU * PX * 100) / 100;
const color = node => {
  if (!node) return null;
  const rgb = descendants(node, "a", "srgbClr")[0];
  const scheme = descendants(node, "a", "schemeClr")[0];
  const value = attr(rgb, "val") || ({ lt1: "FFFFFF", dk1: "000000", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47" })[attr(scheme, "val")];
  if (!/^[0-9a-f]{6}$/i.test(value || "")) return null;
  const alpha = Number(attr(child(rgb || scheme, "a", "alpha"), "val") ?? 100000);
  return `#${value}${alpha < 100000 ? Math.round(Math.max(0, alpha) / 100000 * 255).toString(16).padStart(2, "0") : ""}`;
};
function fillStyle(properties, warnings) {
  const solid = color(child(properties, "a", "solidFill"));
  if (solid) return solid;
  const gradient = child(properties, "a", "gradFill");
  if (!gradient) return "transparent";
  const linear = child(gradient, "a", "lin");
  const stops = children(child(gradient, "a", "gsLst"), "a", "gs").map(stop => {
    const fill = color(stop), position = Number(attr(stop, "pos")) / 1000;
    return fill && Number.isFinite(position) ? `${fill} ${Math.min(100, Math.max(0, position))}%` : null;
  }).filter(Boolean);
  if (!linear || stops.length < 2) { warnings.add("PPTX_GRADIENT_SIMPLIFIED"); return color(gradient) || "transparent"; }
  const angle = Number(attr(linear, "ang") || 0) / 60000 + 90;
  return `linear-gradient(${Number.isFinite(angle) ? angle : 90}deg,${stops.join(",")})`;
}
function shapeHtml(shape, rels, pkg, media, warnings) {
  const sp = child(shape, "p", "sp") || child(shape, "p", "graphicFrame") || child(shape, "p", "pic") || child(shape, "p", "cxnSp");
  if (!sp) return "";
  if (sp.local === "graphicFrame") {
    const graphic = child(sp, "a", "graphic"), graphicData = child(graphic, "a", "graphicData");
    const uri = attr(graphicData, "uri") || "";
    if (uri.endsWith("/table")) {
      const table = child(graphicData, "a", "tbl");
      const xfrm = child(sp, "p", "xfrm"), off = child(xfrm, "a", "off"), ext = child(xfrm, "a", "ext");
      if (!table || !ext) { warnings.add("PPTX_TABLE_RETAINED_IN_ORIGINAL"); return ""; }
      const x = px(attr(off, "x")), y = px(attr(off, "y")), width = Math.max(1, px(attr(ext, "cx"))), height = Math.max(1, px(attr(ext, "cy")));
      const rows = children(table, "a", "tr").map(row => `<tr>${children(row, "a", "tc").map(cell => {
        const properties = child(cell, "a", "tcPr"), gridSpan = Math.max(1, Number(attr(cell, "gridSpan") || 1)), rowSpan = Math.max(1, Number(attr(cell, "rowSpan") || 1));
        // DrawingML stores merge geometry on a:tc, not a:tcPr. Continuation
        // cells occupy the XML grid but must not become additional HTML cells.
        if (["1", "true"].includes(attr(cell, "hMerge")) || ["1", "true"].includes(attr(cell, "vMerge"))) return "";
        if (!Number.isInteger(gridSpan) || !Number.isInteger(rowSpan) || gridSpan > 64 || rowSpan > 200) officeFail("PPTX_TABLE_MERGE_UNSUPPORTED");
        const paras = children(cell, "a", "txBody").flatMap(body => children(body, "a", "p"));
        const text = paras.map(paragraph => descendants(paragraph, "a", "t").map(textContent).join("")).map(esc).join("<br>");
        const fill = color(child(properties, "a", "solidFill"));
        return `<td${gridSpan > 1 ? ` colspan="${gridSpan}"` : ""}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ""}${fill ? ` style="background:${fill}"` : ""}>${text}</td>`;
      }).join("")}</tr>`).join("");
      const markup = `<table data-node-id="${id()}" style="position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;border-collapse:collapse;table-layout:fixed"><tbody>${rows}</tbody></table>`;
      if (children(table, "a", "tr").some(row => children(row, "a", "tc").some(cell => children(child(cell, "a", "txBody"), "a", "p").some(paragraph => descendants(paragraph, "a", "rPr").length > 1)))) warnings.add("PPTX_TABLE_TEXT_FORMATTING_SIMPLIFIED");
      return markup;
    }
    if (uri.endsWith("/chart")) {
      const chart = child(graphicData, "c", "chart");
      const relationId = chart && attribute(chart, "id", "r"), relation = rels.get(relationId);
      if (!relation || relation.external || !relation.target.startsWith("ppt/charts/")) { warnings.add("PPTX_CHART_RELATION_UNSUPPORTED"); return ""; }
      const chartXml = pkg.xml(relation.target), root = chartXml.root, plot = descendants(root, "c", "plotArea")[0];
      const typeNode = (plot?.children || []).find(node => ["barChart", "lineChart", "pieChart"].includes(node.local) && node.uri?.includes("chart"));
      if (!typeNode) { warnings.add("PPTX_CHART_TYPE_UNSUPPORTED"); return ""; }
      const type = ({ barChart: "bar", lineChart: "line", pieChart: "pie" })[typeNode.local];
      const pointValues = (container, cacheName) => {
        const cache = descendants(container, "c", cacheName)[0];
        return cache ? descendants(cache, "c", "pt").map(point => {
          const index = Number(attr(point, "idx")), value = descendants(point, "c", "v")[0];
          return Number.isInteger(index) && index >= 0 && value ? [index, textContent(value)] : null;
        }).filter(Boolean) : [];
      };
      const series = children(typeNode, "c", "ser").map(item => {
        const nameNode = descendants(item, "c", "tx")[0], nameValue = descendants(nameNode, "c", "v")[0];
        const categories = descendants(item, "c", "cat")[0], values = descendants(item, "c", "val")[0];
        const labels = pointValues(categories, "strCache").length ? pointValues(categories, "strCache") : pointValues(categories, "numCache");
        const numbers = pointValues(values, "numCache");
        const read = (points, numeric = false) => points.sort((a, b) => a[0] - b[0]).map(([, value]) => numeric ? Number(value) : value);
        const seriesColor = color(descendants(item, "a", "solidFill")[0]) || "#4472C4";
        return { name: nameValue ? textContent(nameValue) : "Series", labels: read(labels), values: read(numbers, true), color: seriesColor };
      });
      const labels = series[0]?.labels || [], chartSeries = series.map(item => ({ name: item.name, values: item.values, color: item.color }));
      if (!labels.length || labels.length > 100 || !chartSeries.length || chartSeries.length > 10 || chartSeries.some(item => item.values.length !== labels.length) || type === "pie" && (chartSeries.length !== 1 || chartSeries[0].values.some(value => value < 0) || chartSeries[0].values.every(value => value === 0))) {
        warnings.add("PPTX_CHART_DATA_UNSUPPORTED"); return "";
      }
      const chartTitle = descendants(root, "c", "title")[0], title = descendants(chartTitle, "a", "t").map(textContent).join("").slice(0, 160);
      const data = JSON.stringify({ type, title, labels, series: chartSeries });
      const xfrm = child(sp, "p", "xfrm"), off = child(xfrm, "a", "off"), ext = child(xfrm, "a", "ext");
      const x = px(attr(off, "x")), y = px(attr(off, "y")), width = Math.max(1, px(attr(ext, "cx"))), height = Math.max(1, px(attr(ext, "cy")));
      warnings.add("PPTX_CHART_STYLE_SIMPLIFIED");
      return `<div data-node-id="${id()}" data-chart="${esc(data)}" style="position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px"></div>`;
    }
    warnings.add("PPTX_GRAPHIC_RETAINED_IN_ORIGINAL");
    return "";
  }
  const nv = child(sp, "p", "nvSpPr") || child(sp, "p", "nvPicPr") || child(sp, "p", "nvGraphicFramePr") || child(sp, "p", "nvCxnSpPr");
  const name = attr(child(nv, "p", "cNvPr"), "name") || "";
  const xfrm = child(child(sp, "p", "spPr") || child(sp, "p", "xfrm"), "a", "xfrm") || child(sp, "p", "xfrm");
  const off = child(xfrm, "a", "off"), ext = child(xfrm, "a", "ext");
  const x = px(attr(off, "x")), y = px(attr(off, "y")), width = Math.max(1, px(attr(ext, "cx"))), height = Math.max(1, px(attr(ext, "cy")));
  const rotation = Number(attr(xfrm, "rot") || 0) / 60000;
  const transform = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;box-sizing:border-box;overflow:hidden;${rotation ? `transform:rotate(${rotation}deg);transform-origin:center;` : ""}`;
  const blip = descendants(sp, "a", "blip")[0];
  if (blip) {
    const relationId = attribute(blip, "embed", "r"), relation = rels.get(relationId);
    if (relation && !relation.external && /\/media\//.test(relation.target)) {
      let asset = media.find(item => item.source === relation.target);
      if (!asset) {
        if (media.length >= PPTX_MEDIA_COUNT) officeFail("OFFICE_MEDIA_LIMIT");
        asset = { id: id(), source: relation.target, bytes: pkg.read(relation.target) }; media.push(asset);
      }
      const crop = child(child(sp, "p", "blipFill"), "a", "srcRect");
      const [left, top, right, bottom] = ["l", "t", "r", "b"].map(key => Number(attr(crop, key) || 0) / 100000);
      if ([left, top, right, bottom].some(value => !Number.isFinite(value)) || left + right >= 1 || top + bottom >= 1) officeFail("OFFICE_IMAGE_CROP_INVALID");
      const cropped = [left, top, right, bottom].some(Boolean);
      if (cropped) {
        const imageStyle = `position:absolute;left:${-left / (1 - left - right) * 100}%;top:${-top / (1 - top - bottom) * 100}%;width:${100 / (1 - left - right)}%;height:${100 / (1 - top - bottom)}%;max-width:none;object-fit:fill;`;
        return `<div data-node-id="${id()}" style="${transform}"><img data-node-id="${id()}" alt="${esc(name)}" src="asset:${asset.id}" style="${imageStyle}"></div>`;
      }
      const fit = child(child(sp, "p", "blipFill"), "a", "stretch") ? "fill" : "contain";
      return `<img data-node-id="${id()}" alt="${esc(name)}" src="asset:${asset.id}" style="${transform}object-fit:${fit}">`;
    }
    warnings.add("PPTX_IMAGE_RELATION_UNSUPPORTED"); return "";
  }
  const paragraphs = descendants(sp, "a", "p");
  const text = paragraphs.map(paragraph => descendants(paragraph, "a", "t").map(textContent).join("")).join("\n");
  if (!text.trim()) {
    const properties = child(sp, "p", "spPr"), fill = fillStyle(properties, warnings);
    const geometry = child(properties, "a", "prstGeom"), line = child(properties, "a", "ln");
    const stroke = color(child(line, "a", "solidFill"));
    const border = stroke ? `${Math.max(0, px(attr(line, "w") || 9525))}px solid ${stroke}` : "none";
    if (geometry || fill !== "transparent") return `<div data-node-id="${id()}" aria-label="${esc(name)}" style="${transform}background:${fill};border:${border};${attr(geometry, "prst") === "ellipse" ? "border-radius:50%;" : ""}"></div>`;
    return "";
  }
  const textStyle = properties => {
    const font = child(properties, "a", "ea") || child(properties, "a", "latin");
    const size = attr(properties, "sz"), fill = color(child(properties, "a", "solidFill"));
    const spacing = attr(properties, "spc");
    return `${spacing !== undefined ? `letter-spacing:${Number(spacing) / 100 * 96 / 72}px;` : ""}${size ? `font-size:${Math.min(682, Math.max(1, Number(size) / 100 * 96 / 72))}px;` : ""}${font ? `font-family:${JSON.stringify(attr(font, "typeface") || "Arial")},sans-serif;` : ""}${fill ? `color:${fill};` : ""}${attr(properties, "b") !== undefined ? `font-weight:${attr(properties, "b") === "1" ? "bold" : "normal"};` : ""}${attr(properties, "i") !== undefined ? `font-style:${attr(properties, "i") === "1" ? "italic" : "normal"};` : ""}${attr(properties, "u") && attr(properties, "u") !== "none" ? "text-decoration:underline;" : ""}`;
  };
  const richText = paragraphs.map(paragraph => {
    const properties = child(paragraph, "a", "pPr"), defaults = child(properties, "a", "defRPr");
    const align = ({ ctr: "center", r: "right", l: "left", just: "justify" })[attr(properties, "algn")] || "left";
    const runs = (paragraph.children || []).map(run => {
      if (run.local === "br") return "<br>";
      if (!["r", "fld"].includes(run.local)) return "";
      const value = descendants(run, "a", "t").map(textContent).join("");
      return `<span style="${esc(textStyle(child(run, "a", "rPr")))}">${esc(value)}</span>`;
    }).join("");
    const spacing = child(properties, "a", "lnSpc"), percent = attr(child(spacing, "a", "spcPct"), "val"), points = attr(child(spacing, "a", "spcPts"), "val");
    const lineHeight = percent !== undefined ? Number(percent) / 100000 : points !== undefined ? `${Number(points) / 100 * 96 / 72}px` : "normal";
    return `<p style="${esc(`margin:0;text-align:${align};line-height:${lineHeight};${textStyle(defaults)}`)}">${runs || "<br>"}</p>`;
  }).join("");
  const bodyProperties = child(child(sp, "p", "txBody"), "a", "bodyPr");
  const padding = ["tIns", "rIns", "bIns", "lIns"].map((key, index) => `${Math.max(0, px(attr(bodyProperties, key) ?? (index % 2 ? 91440 : 45720)))}px`).join(" ");
  const verticalAlign = ({ ctr: "center", b: "flex-end" })[attr(bodyProperties, "anchor")] || "flex-start";
  const baseStyle = `${transform}display:flex;flex-direction:column;justify-content:${verticalAlign};padding:${padding};font-size:24px;color:#202124;white-space:pre-wrap;overflow-wrap:anywhere;`;
  return `<div data-node-id="${id()}" style="${esc(baseStyle)}">${richText}</div>`;
}

export function importPresentationHtml(bytes, { title = "Imported presentation" } = {}) {
  const pkg = officePackage(bytes, { maxBytes: officeImportBytes("pptx") });
  const presentationPath = "ppt/presentation.xml";
  if (!pkg.has(presentationPath)) officeFail("OFFICE_PRESENTATION_INVALID");
  const presentation = pkg.xml(presentationPath), slideRefs = descendants(presentation.root, "p", "sldId"), rels = pkg.relationships(presentationPath);
  const dimensions = child(presentation.root, "p", "sldSz"), width = Math.max(1, Math.min(8192, Math.round(px(attr(dimensions, "cx"))))), height = Math.max(1, Math.min(8192, Math.round(px(attr(dimensions, "cy")))));
  if (!slideRefs.length || slideRefs.length > 100) officeFail("OFFICE_SLIDE_LIMIT");
  const warnings = new Set(), media = [], pages = [];
  for (const [index, reference] of slideRefs.entries()) {
    const relationId = attribute(reference, "id", "r"), relation = rels.get(relationId);
    if (!relation || relation.external || !relation.target.startsWith("ppt/slides/")) officeFail("OFFICE_RELATIONSHIP_INVALID");
    const xml = pkg.xml(relation.target), slideRels = pkg.relationships(relation.target), tree = child(xml.root, "p", "cSld"), shapeTree = child(tree, "p", "spTree");
    const objects = (shapeTree?.children || []).filter(node => ["sp", "pic", "graphicFrame", "cxnSp"].includes(node.local) && node.uri?.includes("presentationml"));
    if ((shapeTree?.children || []).some(node => node.local === "grpSp")) warnings.add("PPTX_GROUPED_SHAPES_RETAINED_IN_ORIGINAL");
    const body = objects.map(node => shapeHtml({ children: [node] }, slideRels, pkg, media, warnings)).join("");
    const notesRelation = [...slideRels.values()].find(item => !item.external && item.type.endsWith("/notesSlide"));
    const notesXml = notesRelation ? pkg.xml(notesRelation.target) : null;
    const notesShape = notesXml && descendants(notesXml.root, "p", "sp").find(item => descendants(child(item, "p", "nvSpPr"), "p", "ph").some(placeholder => attr(placeholder, "type") === "body"));
    const notes = notesShape ? descendants(notesShape, "a", "p").map(paragraph => descendants(paragraph, "a", "t").map(textContent).join("")).join("\n") : "";
    if (notesXml && !notesShape && descendants(notesXml.root, "a", "t").length) warnings.add("PPTX_NOTES_LAYOUT_UNSUPPORTED");
    const background = color(child(child(tree, "p", "bg"), "p", "bgPr")) || "#ffffff";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="vimg-width" content="${width}"><meta name="vimg-height" content="${height}"><style>html,body{margin:0;width:${width}px;height:${height}px;background:${background};font-family:Arial,"Microsoft YaHei",sans-serif}body{position:relative;overflow:hidden}</style></head><body>${body}</body></html>`;
    // Keep text runs/paragraphs addressable in the source as well as its preview.
    pages.push({ id: id(), title: `Slide ${index + 1}`, width, height, html: inspectHtml(html, { assignIds: true, allowEmpty: true }).html, notes, hidden: attr(xml.root, "show") === "0" });
  }
  const document = htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-slides", kind: "slides", title: title.replace(/\.pptx$/i, "").slice(0, 160) || "Imported presentation",
    theme: { name: "Imported", primary: "#4472C4", accent: "#ED7D31", background: "#FFFFFF", fontFamily: "sans" }, pages, metadata: { importedFrom: "pptx", warnings: [...warnings] }, templates: [] });
  return { content: document, media, warnings: [...warnings] };
}
