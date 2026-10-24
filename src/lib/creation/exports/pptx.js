import JSZip from "jszip";
import { layoutDocumentSchema } from "../contracts/layout.js";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const fonts = { sans: ["Arial", "Microsoft YaHei"], serif: ["Georgia", "Noto Serif SC"], mono: ["Consolas", "Microsoft YaHei"] };
const xml = value => String(value).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const emu = value => Math.round(value * 9525); // 96 CSS px per inch
const point = value => Math.round(value * 75); // hundredths of a point
const color = (value, opacity = 1) => `<a:srgbClr val="${value.slice(1, 7).toUpperCase()}"><a:alpha val="${Math.round(opacity * (value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1) * 100000)}"/></a:srgbClr>`;
const schemeRoles = { primary: "dk1", accent: "accent1", background: "lt1" };
const sameColor = (a, b) => a?.toLowerCase().replace(/^(.{7})ff$/, "$1") === b?.toLowerCase().replace(/^(.{7})ff$/, "$1");
const fill = (value, opacity = 1, role, theme) => {
  // A locked object's materialized paint may predate the current palette.
  // Preserve its actual appearance instead of re-binding a stale value.
  const paint = Object.hasOwn(schemeRoles, role) && sameColor(value, theme?.[role])
    ? `<a:schemeClr val="${schemeRoles[role]}"><a:alpha val="${Math.round(opacity * (value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1) * 100000)}"/></a:schemeClr>` : color(value, opacity);
  return `<a:solidFill>${paint}</a:solidFill>`;
};
const relations = items => `${HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${xml(target)}"/>`).join("")}</Relationships>`;
const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function transform(node, frame = { x: 0, y: 0, width: node.width, height: node.height }) {
  // Konva rotates at the top-left, while DrawingML rotates at the center.
  const angle = node.rotation * Math.PI / 180, cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
  const x = node.x + cx * Math.cos(angle) - cy * Math.sin(angle) - frame.width / 2;
  const y = node.y + cx * Math.sin(angle) + cy * Math.cos(angle) - frame.height / 2;
  return `<a:xfrm rot="${Math.round(((node.rotation % 360 + 360) % 360) * 60000)}"><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(frame.width)}" cy="${emu(frame.height)}"/></a:xfrm>`;
}
const geometry = (shape, radius = 0, width = 1, height = 1) => `<a:prstGeom prst="${shape}"><a:avLst>${shape === "roundRect" ? `<a:gd name="adj" fmla="val ${Math.round(Math.min(.5, radius / Math.min(width, height)) * 100000)}"/>` : ""}</a:avLst></a:prstGeom>`;
function nonVisual(node, id) { return `<p:cNvPr id="${id}" name="${xml(node.name)}" descr="${xml(node.type === "image" ? node.alt : "")}"/>`; }
function textBody(node, theme) {
  const style = node.style, [latin, eastAsia] = fonts[style.fontFamily];
  const properties = `lang="zh-CN" sz="${point(style.fontSize)}" b="${style.fontWeight === "bold" ? 1 : 0}" i="${style.fontStyle === "italic" ? 1 : 0}" spc="${point(style.letterSpacing)}"`;
  const follow = style.fontRole === "theme" && style.fontFamily === theme.fontFamily;
  const run = `${fill(style.fill, node.opacity, style.fillRole, theme)}<a:latin typeface="${follow ? "+mn-lt" : latin}"/><a:ea typeface="${follow ? "+mn-ea" : eastAsia}"/><a:cs typeface="${follow ? "+mn-cs" : latin}"/>`;
  return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${{ top: "t", middle: "ctr", bottom: "b" }[style.verticalAlign]}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${node.text.split("\n").map(line => `<a:p><a:pPr algn="${{ left: "l", center: "ctr", right: "r" }[style.align]}"><a:lnSpc><a:spcPct val="${Math.round(style.lineHeight * 100000)}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr ${properties}>${run}</a:rPr><a:t xml:space="preserve">${xml(line)}</a:t></a:r><a:endParaRPr ${properties}/></a:p>`).join("")}</p:txBody>`;
}
function shapeXml(node, id, theme) {
  const isText = node.type === "text";
  let paint = "<a:noFill/><a:ln><a:noFill/></a:ln>", preset = "rect";
  if (!isText) {
    preset = node.shape === "ellipse" ? "ellipse" : node.shape === "line" ? "line" : node.radius ? "roundRect" : "rect";
    const stroke = node.shape === "line" && !node.strokeWidth ? node.fill : node.stroke;
    const width = node.shape === "line" ? node.strokeWidth || 2 : node.strokeWidth;
    const strokeRole = node.shape === "line" && !node.strokeWidth ? node.fillRole : node.strokeRole;
    paint = `${node.shape === "line" ? "<a:noFill/>" : fill(node.fill, node.opacity, node.fillRole, theme)}<a:ln w="${emu(width)}">${width ? fill(stroke, node.opacity, strokeRole, theme) : "<a:noFill/>"}<a:prstDash val="solid"/></a:ln>`;
  }
  return `<p:sp><p:nvSpPr>${nonVisual(node, id)}<p:cNvSpPr${isText ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr><p:spPr>${transform(node)}${geometry(preset, node.radius, node.width, node.height)}${paint}</p:spPr>${isText ? textBody(node, theme) : ""}</p:sp>`;
}
function imageXml(node, id, media, relId) {
  let frame, crop = "";
  if (node.fit === "contain") {
    const scale = Math.min(node.width / media.width, node.height / media.height), width = media.width * scale, height = media.height * scale;
    frame = { x: (node.width - width) / 2, y: (node.height - height) / 2, width, height };
  } else if (node.fit === "cover") {
    const scale = Math.max(node.width / media.width, node.height / media.height);
    const horizontal = Math.round((1 - node.width / (media.width * scale)) * 50000), vertical = Math.round((1 - node.height / (media.height * scale)) * 50000);
    crop = `<a:srcRect l="${horizontal}" r="${horizontal}" t="${vertical}" b="${vertical}"/>`;
  }
  return `<p:pic><p:nvPicPr>${nonVisual(node, id)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"><a:alphaModFix amt="${Math.round(node.opacity * 100000)}"/></a:blip>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform(node, frame)}${geometry("rect")}</p:spPr></p:pic>`;
}

const themeXml = theme => `${HEADER}<a:theme xmlns:a="${A}" name="${xml(theme.name)}"><a:themeElements><a:clrScheme name="Default">${[["dk1", theme.primary.slice(1, 7).toUpperCase()], ["lt1", theme.background.slice(1, 7).toUpperCase()], ["dk2", "202124"], ["lt2", "EEEEEE"], ["accent1", theme.accent.slice(1, 7).toUpperCase()], ["accent2", "10B981"], ["accent3", "F59E0B"], ["accent4", "EF4444"], ["accent5", "8B5CF6"], ["accent6", "06B6D4"], ["hlink", "2563EB"], ["folHlink", "8B5CF6"]].map(([key, value]) => `<a:${key}><a:srgbClr val="${value}"/></a:${key}>`).join("")}</a:clrScheme><a:fontScheme name="Default"><a:majorFont><a:latin typeface="${fonts[theme.fontFamily][0]}"/><a:ea typeface="${fonts[theme.fontFamily][1]}"/><a:cs typeface="${fonts[theme.fontFamily][0]}"/></a:majorFont><a:minorFont><a:latin typeface="${fonts[theme.fontFamily][0]}"/><a:ea typeface="${fonts[theme.fontFamily][1]}"/><a:cs typeface="${fonts[theme.fontFamily][0]}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Default"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map(width => `<a:ln w="${width}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const colorMap = '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>';

export async function buildLayoutPptx(input, images = new Map(), { maxBytes = 64 * 1024 * 1024 } = {}) {
  const document = layoutDocumentSchema.parse(input);
  if (document.kind !== "slides") throw new Error("EXPORT_KIND_UNSUPPORTED");
  const first = document.pages[0];
  // PowerPoint supports one slide size per deck, 1–56 inches. Do not silently
  // rescale heterogeneous boards or crop them to the first page's dimensions.
  if (document.pages.some(page => page.width !== first.width || page.height !== first.height || page.width < 96 || page.height < 96 || page.width > 5376 || page.height > 5376)) throw new Error("EXPORT_SLIDE_SIZE_UNSUPPORTED");
  const zip = new JSZip(), overrides = [], media = new Map();
  const add = (path, body, type) => { zip.file(path, body, { date: new Date("2000-01-01T00:00:00Z") }); if (type) overrides.push([`/${path}`, type]); };
  const part = suffix => `application/vnd.openxmlformats-officedocument.presentationml.${suffix}+xml`;
  let imageBytes = 0;
  for (const page of document.pages) for (const node of page.nodes) if (node.visible && node.type === "image" && !media.has(node.assetId)) {
    const image = images.get(node.assetId);
    if (!image || !Buffer.isBuffer(image.bytes) || !["png", "jpeg"].includes(image.format) || !(image.width > 0 && image.height > 0)) throw new Error("EXPORT_IMAGE_MISSING");
    imageBytes += image.bytes.length;
    if (media.size >= 100 || imageBytes > 100 * 1024 * 1024) throw new Error("EXPORT_ASSETS_TOO_LARGE");
    const name = `image${media.size + 1}.${image.format === "jpeg" ? "jpg" : "png"}`;
    media.set(node.assetId, { ...image, name }); add(`ppt/media/${name}`, image.bytes);
  }
  add("_rels/.rels", relations([["rId1", "officeDocument", "ppt/presentation.xml"], ["rId2", "extended-properties", "docProps/app.xml"]]));
  add("docProps/app.xml", `${HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ModelShot</Application><PresentationFormat>Custom</PresentationFormat><Slides>${document.pages.length}</Slides><Notes>${document.pages.length}</Notes></Properties>`, "application/vnd.openxmlformats-officedocument.extended-properties+xml");
  add("ppt/theme/theme1.xml", themeXml(document.theme), "application/vnd.openxmlformats-officedocument.theme+xml");
  add("ppt/slideMasters/slideMaster1.xml", `${HEADER}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`, part("slideMaster"));
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", relations([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]));
  add("ppt/slideLayouts/slideLayout1.xml", `${HEADER}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`, part("slideLayout"));
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relations([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
  add("ppt/notesMasters/notesMaster1.xml", `${HEADER}<p:notesMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:notesStyle/></p:notesMaster>`, part("notesMaster"));
  add("ppt/notesMasters/_rels/notesMaster1.xml.rels", relations([["rId1", "theme", "../theme/theme1.xml"]]));
  for (let index = 0; index < document.pages.length; index++) {
    const page = document.pages[index], number = index + 1;
    const rels = [["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "notesSlide", `../notesSlides/notesSlide${number}.xml`]];
    const nodes = page.nodes.filter(node => node.visible).map((node, nodeIndex) => {
      if (node.type !== "image") return shapeXml(node, nodeIndex + 2, document.theme);
      const image = media.get(node.assetId), id = `rId${rels.length + 1}`;
      rels.push([id, "image", `../media/${image.name}`]); return imageXml(node, nodeIndex + 2, image, id);
    }).join("");
    add(`ppt/slides/slide${number}.xml`, `${HEADER}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" show="${page.hidden ? 0 : 1}"><p:cSld name="${xml(page.title)}"><p:bg><p:bgPr>${fill(page.background, 1, page.backgroundRole, document.theme)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${nodes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`, part("slide"));
    add(`ppt/slides/_rels/slide${number}.xml.rels`, relations(rels));
    add(`ppt/notesSlides/notesSlide${number}.xml`, `${HEADER}<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>${group}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Speaker notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${page.notes.split("\n").map(line => `<a:p><a:r><a:t xml:space="preserve">${xml(line)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`, part("notesSlide"));
    add(`ppt/notesSlides/_rels/notesSlide${number}.xml.rels`, relations([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", `../slides/slide${number}.xml`]]));
  }
  add("ppt/presentation.xml", `${HEADER}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${document.pages.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${emu(first.width)}" cy="${emu(first.height)}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`, part("presentation.main"));
  add("ppt/_rels/presentation.xml.rels", relations([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "notesMaster", "notesMasters/notesMaster1.xml"], ...document.pages.map((_, index) => [`rId${index + 3}`, "slide", `slides/slide${index + 1}.xml`])]));
  add("[Content_Types].xml", `${HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>${overrides.map(([name, type]) => `<Override PartName="${name}" ContentType="${type}"/>`).join("")}</Types>`);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (output.length > maxBytes) throw new Error("EXPORT_RESULT_TOO_LARGE");
  return output;
}
