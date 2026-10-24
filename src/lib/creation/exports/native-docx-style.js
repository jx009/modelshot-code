import { docxFail as fail, docxKeys as keys, docxNumber as number } from "./native-docx-model.js";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ordered = (items, names) => items.sort((a, b) => names.indexOf(/^<w:(\w+)/.exec(a)?.[1]) - names.indexOf(/^<w:(\w+)/.exec(b)?.[1])).join("");
export function xml(value) {
  const text = String(value);
  if (!text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(text)) fail("EXPORT_DOCUMENT_TEXT_UNSUPPORTED");
  return text.replace(/[&<>"'\r\n\t]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;", "\r": "&#13;", "\n": "&#10;", "\t": "&#9;" })[c]);
}
export function rgb(value) {
  keys(value, ["rgb"]); let color = value.rgb;
  if (typeof color !== "string") fail();
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color);
  if (match && match.slice(1).every(v => +v <= 255)) color = `#${match.slice(1).map(v => (+v).toString(16).padStart(2, "0")).join("")}`;
  if (/^#[a-f0-9]{3}$/i.test(color)) color = `#${[...color.slice(1)].map(c => c + c).join("")}`;
  if (!/^#[a-f0-9]{6}$/i.test(color)) fail(); return color.slice(1).toUpperCase();
}
export const bool = value => number(value, 0, 1, true);
export const pxTwips = value => Math.round(number(value, 0, 3000) * 15);
export function unitTwips(value, negative = false) {
  keys(value, ["v", "u"]); const unit = value.u ?? 0;
  if (![0, 3].includes(unit)) fail();
  return Math.round(number(value.v, negative ? -3000 : 0, 3000) * (unit === 0 ? 20 : 15));
}
const decorations = ["dash", "dashDotDotHeavy", "dashDotHeavy", "dashedHeavy", "dashLong", "dashLongHeavy", "dotDash", "dotDotDash", "dotted", "dottedHeavy", "double", "none", "single", "thick", "wave", "wavyDouble", "wavyHeavy", "words"];
export function textProperties(style = {}) {
  keys(style, ["ff", "eastAsiaFontFamily", "fs", "bl", "it", "ul", "st", "ol", "bbl", "cl", "bg", "va", "hidden", "caps", "smallCaps", "lang", "altLang", "kerning", "fontHint"]);
  const out = [];
  for (const key of ["ff", "eastAsiaFontFamily"]) if (style[key] != null && (typeof style[key] !== "string" || !style[key].length || style[key].length > 128)) fail();
  if (style.fontHint != null && !["default", "eastAsia", "cs"].includes(style.fontHint)) fail();
  if (style.ff || style.eastAsiaFontFamily || style.fontHint) out.push(`<w:rFonts${style.ff ? ` w:ascii="${xml(style.ff)}" w:hAnsi="${xml(style.ff)}" w:cs="${xml(style.ff)}"` : ""}${style.eastAsiaFontFamily ? ` w:eastAsia="${xml(style.eastAsiaFontFamily)}"` : ""}${style.fontHint ? ` w:hint="${style.fontHint}"` : ""}/>`);
  for (const [key, tag] of [["bl", "b"], ["it", "i"]]) if (style[key] != null) out.push(`<w:${tag} w:val="${bool(style[key])}"/>`);
  for (const [key, tag] of [["hidden", "vanish"], ["caps", "caps"], ["smallCaps", "smallCaps"]]) if (style[key] != null) {
    if (typeof style[key] !== "boolean") fail(); out.push(`<w:${tag} w:val="${Number(style[key])}"/>`);
  }
  if (style.ul != null) {
    const u = style.ul; keys(u, ["s", "c", "cl", "t"]);
    const type = u.t ?? 12; if (!decorations[type]) fail(); if (u.c != null) bool(u.c);
    out.push(`<w:u w:val="${bool(u.s) ? decorations[type] : "none"}"${u.c === 0 && u.cl ? ` w:color="${rgb(u.cl)}"` : ""}/>`);
  }
  if (style.st != null) {
    const s = style.st; keys(s, ["s", "c", "cl", "t"]);
    if (s.c != null && bool(s.c) === 0 || s.t != null && s.t !== 12) fail(); out.push(`<w:strike w:val="${bool(s.s)}"/>`);
  }
  for (const key of ["ol", "bbl"]) if (style[key] != null) { keys(style[key], ["s"]); if (bool(style[key].s)) fail(); }
  if (style.cl) out.push(`<w:color w:val="${rgb(style.cl)}"/>`);
  if (style.fs != null) { const size = Math.round(number(style.fs, 1, 400) * 2); out.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`); }
  if (style.bg) out.push(`<w:shd w:val="clear" w:color="auto" w:fill="${rgb(style.bg)}"/>`);
  if (style.va != null) out.push(`<w:vertAlign w:val="${["", "baseline", "subscript", "superscript"][number(style.va, 1, 3, true)]}"/>`);
  if (style.kerning != null) out.push(`<w:kern w:val="${Math.round(number(style.kerning, 0, 400) * 2)}"/>`);
  for (const key of ["lang", "altLang"]) if (style[key] != null && (typeof style[key] !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(style[key]))) fail();
  if (style.lang || style.altLang) out.push(`<w:lang${style.lang ? ` w:val="${xml(style.lang)}"` : ""}${style.altLang ? ` w:eastAsia="${xml(style.altLang)}"` : ""}/>`);
  return ordered(out, ["rFonts", "b", "i", "caps", "smallCaps", "strike", "vanish", "color", "kern", "sz", "u", "shd", "vertAlign", "lang"]);
}
export function paragraphProperties(style = {}, extras = "") {
  keys(style, ["headingId", "namedStyleType", "outlineLevel", "textStyle", "paragraphMarkTextStyle", "horizontalAlign", "direction", "lineSpacing", "spacingRule", "spaceAbove", "spaceBelow", "indentStart", "indentEnd", "indentFirstLine", "hanging", "keepNext", "keepLines", "pageBreakBefore", "widowControl", "wordWrap", "snapToGrid", "contextualSpacing", "suppressHyphenation", "beforeAutoSpacing", "afterAutoSpacing", "shading", "tabStops"]);
  const out = Array.isArray(extras) ? [...extras] : [extras];
  for (const key of ["keepNext", "keepLines", "pageBreakBefore", "widowControl", "wordWrap", "snapToGrid", "contextualSpacing", "suppressHyphenation"]) if (style[key] != null) out.push(`<w:${key === "suppressHyphenation" ? "suppressAutoHyph" : key} w:val="${bool(style[key])}"/>`);
  const spacing = [];
  if (style.spaceAbove) spacing.push(`w:before="${unitTwips(style.spaceAbove)}"`);
  if (style.spaceBelow) spacing.push(`w:after="${unitTwips(style.spaceBelow)}"`);
  for (const [key, attr] of [["beforeAutoSpacing", "beforeAutospacing"], ["afterAutoSpacing", "afterAutospacing"]]) if (style[key] != null) spacing.push(`w:${attr}="${bool(style[key])}"`);
  if (style.lineSpacing != null) { const rule = number(style.spacingRule ?? 0, 0, 2, true); spacing.push(`w:line="${Math.round(number(style.lineSpacing, 0.1, 400) * (rule ? 20 : 240))}" w:lineRule="${["auto", "atLeast", "exact"][rule]}"`); }
  else if (style.spacingRule != null && style.spacingRule !== 0) fail();
  if (spacing.length) out.push(`<w:spacing ${spacing.join(" ")}/>`);
  const indents = [];
  for (const [key, attr] of [["indentStart", "left"], ["indentEnd", "right"], ["indentFirstLine", "firstLine"], ["hanging", "hanging"]]) if (style[key]) indents.push(`w:${attr}="${unitTwips(style[key], key === "indentStart" || key === "indentEnd")}"`);
  if (style.indentFirstLine && style.hanging && style.indentFirstLine.v && style.hanging.v) fail();
  if (indents.length) out.push(`<w:ind ${indents.join(" ")}/>`);
  if (style.horizontalAlign != null) out.push(`<w:jc w:val="${["left", "left", "center", "right", "both", "both", "distribute"][number(style.horizontalAlign, 0, 6, true)]}"/>`);
  if (style.direction != null) out.push(`<w:bidi w:val="${number(style.direction, 0, 2, true) === 2 ? 1 : 0}"/>`);
  if (style.outlineLevel != null) out.push(`<w:outlineLvl w:val="${number(style.outlineLevel, 0, 9, true)}"/>`);
  if (style.shading) { keys(style.shading, ["backgroundColor"]); out.push(`<w:shd w:val="clear" w:fill="${rgb(style.shading.backgroundColor)}"/>`); }
  if (style.tabStops != null) {
    if (!Array.isArray(style.tabStops) || style.tabStops.length > 64) fail();
    out.push(`<w:tabs>${style.tabStops.map(tab => {
      keys(tab, ["offset", "alignment", "leader", "clear"]);
      if (tab.clear != null && typeof tab.clear !== "boolean") fail();
      return `<w:tab w:val="${tab.clear ? "clear" : ["left", "left", "center", "right"][number(tab.alignment, 0, 3, true)]}" w:pos="${Math.round(number(tab.offset, 0, 3000) * 20)}"${tab.leader == null ? "" : ` w:leader="${["none", "none", "dot", "hyphen", "underscore", "heavy", "middleDot"][number(tab.leader, 0, 6, true)]}"`}/>`;
    }).join("")}</w:tabs>`);
  }
  return ordered(out, ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "widowControl", "numPr", "shd", "tabs", "suppressAutoHyph", "wordWrap", "bidi", "snapToGrid", "spacing", "ind", "contextualSpacing", "jc", "outlineLvl"]);
}

// Versioned defaults from Univer 1.2.0. Direct formatting is resolved later.
export const namedText = [{}, {}, { fs: 26, bl: 1 }, { fs: 15, cl: { rgb: "#999999" } }, ...[20, 18, 16, 14, 12].map(fs => ({ fs, bl: 1 }))];
export const namedSpacing = [{}, ...[[0, 12], [0, 7], [0, 16], [20, 10], [18, 10], [16, 10], [14, 8], [12, 8]].map(([before, after]) => ({ spaceAbove: { v: before }, spaceBelow: { v: after } }))];
