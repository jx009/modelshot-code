// Runs through Playwright's trusted evaluation channel in the scriptless page.
// This produces an export projection; it never replaces authoritative HTML.
export function measureHtmlSlide() {
  const nodes = [], tables = [], charts = [], warnings = [], raster = [];
  const color = value => { const parts = value.match(/[\d.]+/g)?.map(Number); return parts?.length >= 3 ? `#${parts.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}${parts.length > 3 ? Math.round(parts[3] * 255).toString(16).padStart(2, "0") : ""}` : "#000000"; };
  let seq = 0;
  const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) }; };
  const base = element => ({ id: `e${++seq}`, name: element.getAttribute("aria-label") || element.tagName, ...box(element), rotation: 0, opacity: Number(getComputedStyle(element).opacity), visible: true, locked: false });
  const font = style => ({ fontFamily: /mono|consolas/i.test(style.fontFamily) ? "mono" : /serif/i.test(style.fontFamily) && !/sans/i.test(style.fontFamily) ? "serif" : "sans", fontSize: Math.min(512, Math.max(6, parseFloat(style.fontSize) || 16)), fontWeight: parseInt(style.fontWeight) >= 600 ? "bold" : "normal", fontStyle: style.fontStyle === "italic" ? "italic" : "normal", align: ["left", "right", "center"].includes(style.textAlign) ? style.textAlign : "left", verticalAlign: "top", lineHeight: Math.max(.8, Math.min(3, (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) / parseFloat(style.fontSize))), letterSpacing: Math.max(-20, Math.min(100, parseFloat(style.letterSpacing) || 0)), fill: color(style.color) });
  function visit(element) {
    const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return;
    if (element.hasAttribute("data-chart")) { charts.push({ ...base(element), data: JSON.parse(element.getAttribute("data-chart")) }); return; }
    if (element.tagName === "TABLE") {
      const rows = [...element.rows].map(row => ({ height: row.getBoundingClientRect().height, cells: [...row.cells].map(cell => { const css = getComputedStyle(cell); return { text: cell.innerText, ...box(cell), colSpan: cell.colSpan, rowSpan: cell.rowSpan, style: font(css), background: color(css.backgroundColor) }; }) }));
      tables.push({ ...base(element), rows }); return;
    }
    if (element.tagName === "svg" || element.tagName === "SVG") { raster.push({ ...base(element), selector: element.getAttribute("data-node-id") }); warnings.push("SVG_OBJECT_RASTERIZED"); return; }
    if (element.tagName === "IMG") { nodes.push({ ...base(element), type: "image", assetId: element.getAttribute("data-export-asset"), fit: ["contain", "cover"].includes(style.objectFit) ? style.objectFit : "stretch", alt: element.alt || "" }); return; }
    // 背景图/渐变：在原位置、原层级放一张只含背景的截图，子元素的文字和形状照常导出为可编辑对象。
    // 背景截图已包含背景色和边框，所以这类元素不再另画矩形。
    const backgroundImage = style.backgroundImage !== "none";
    if (backgroundImage && bounds.width > 0 && bounds.height > 0) {
      const mark = `bg${++seq}`;
      element.setAttribute("data-export-bg", mark);
      nodes.push({ ...base(element), type: "image", assetId: null, fit: "stretch", alt: "", backgroundMark: mark });
      warnings.push("CSS_BACKGROUND_RASTERIZED");
    }
    if (style.transform !== "none" || style.rotate !== "none") warnings.push("CSS_TRANSFORM_APPROXIMATED");
    if (style.boxShadow !== "none" || style.textShadow !== "none") warnings.push("CSS_SHADOW_OMITTED");
    if (!backgroundImage && bounds.width > 0 && bounds.height > 0 && (style.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(style.borderTopWidth) > 0)) nodes.push({ ...base(element), type: "shape", shape: "rectangle", fill: color(style.backgroundColor), stroke: color(style.borderTopColor), strokeWidth: Math.min(64, parseFloat(style.borderTopWidth) || 0), radius: Math.min(512, parseFloat(style.borderTopLeftRadius) || 0) });
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) visit(child);
      else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        const range = document.createRange(); range.selectNodeContents(child); const r = range.getBoundingClientRect();
        if (r.width && r.height) nodes.push({ ...base(element), id: `t${++seq}`, name: "Text", type: "text", text: child.textContent.trim(), x: r.x, y: r.y, width: Math.max(1, r.width + 2), height: Math.max(1, r.height + 4), style: font(style) });
      }
    }
  }
  visit(document.body);
  if (nodes.length + tables.length + charts.length + raster.length > 500) throw new Error("EXPORT_HTML_NODE_LIMIT");
  return { nodes, tables, charts, raster, warnings: [...new Set(warnings)], background: color(getComputedStyle(document.body).backgroundColor) };
}
