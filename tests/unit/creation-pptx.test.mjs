// @vitest-environment jsdom
import { expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { posix } from "node:path";
import { buildLayoutPptx } from "../../src/lib/creation/exports/pptx.js";
import { layoutDocumentSchema } from "../../src/lib/creation/contracts/layout.js";
import { importPresentationHtml } from "../../src/lib/creation/office/pptx-html.js";
import { inspectHtml } from "../../src/lib/creation/html/document.js";

const base = { x: 40, y: 50, width: 300, height: 100, name: "Editable" };
function deck() {
  return layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: "Test", theme: { name: "Test", primary: "#112233", accent: "#ff9900", background: "#ffffff", fontFamily: "sans" }, pages: [
    { id: "one", title: '中文 < & "', width: 1280, height: 720, notes: "私有备注\n第二行", nodes: [
      { ...base, id: "text", type: "text", text: "咖啡开业 <script> &\n11 月 1 日", rotation: 90, opacity: .5, style: { fontSize: 48, fill: "#12345680", fontWeight: "bold", fontStyle: "italic", verticalAlign: "middle", align: "center", letterSpacing: 2, lineHeight: 1.4 } },
      { ...base, id: "shape", type: "shape", shape: "rectangle", radius: 12, strokeWidth: 3, stroke: "#ff0000", locked: true },
      { ...base, id: "invisible", type: "text", text: "Do not export", visible: false, style: {} },
    ] },
    { id: "two", title: "Hidden", width: 1280, height: 720, hidden: true, notes: "", nodes: [] },
  ] });
}
const parse = source => new DOMParser().parseFromString(source, "application/xml");
const all = (document, name) => [...document.getElementsByTagName(name)];

it("exports native theme colors/fonts while preserving custom and stale locked paint", async () => {
  const document = deck();
  document.theme = { name: '品牌 & "主题"', primary: "#33557780", accent: "#cc8844", background: "#fefcf9", fontFamily: "serif" };
  Object.assign(document.pages[0], { background: document.theme.background, backgroundRole: "background" });
  Object.assign(document.pages[0].nodes[0].style, { fill: document.theme.primary, fillRole: "primary", fontFamily: "serif", fontRole: "theme" });
  Object.assign(document.pages[0].nodes[1], { fill: "#eeeeee", fillRole: "primary", stroke: document.theme.accent, strokeRole: "custom" });
  const zip = await JSZip.loadAsync(await buildLayoutPptx(document));
  const slide = parse(await zip.file("ppt/slides/slide1.xml").async("string")), theme = parse(await zip.file("ppt/theme/theme1.xml").async("string"));
  expect(all(theme, "parsererror")).toHaveLength(0);
  expect(all(theme, "a:theme")[0].getAttribute("name")).toBe(document.theme.name);
  expect(all(theme, "a:dk1")[0].firstElementChild.getAttribute("val")).toBe("335577");
  expect(all(theme, "a:accent1")[0].firstElementChild.getAttribute("val")).toBe("CC8844");
  expect(all(all(theme, "a:minorFont")[0], "a:latin")[0].getAttribute("typeface")).toBe("Georgia");
  expect(all(slide, "a:schemeClr").map(node => node.getAttribute("val"))).toContain("lt1");
  const run = all(slide, "a:rPr")[0];
  expect(all(run, "a:schemeClr")[0].getAttribute("val")).toBe("dk1");
  expect(all(run, "a:alpha")[0].getAttribute("val")).toBe("25098");
  expect(all(run, "a:latin")[0].getAttribute("typeface")).toBe("+mn-lt");
  const shape = all(slide, "p:sp")[1];
  expect(all(shape, "a:schemeClr")).toHaveLength(0);
  expect(all(shape, "a:srgbClr").map(node => node.getAttribute("val"))).toEqual(["EEEEEE", "CC8844"]);
});

it("creates editable text and shapes, notes, hidden slides and valid package relationships without screenshots", async () => {
  const zip = await JSZip.loadAsync(await buildLayoutPptx(deck()));
  const types = parse(await zip.file("[Content_Types].xml").async("string"));
  expect(all(types, "Override").find(node => node.getAttribute("PartName") === "/ppt/presentation.xml").getAttribute("ContentType")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
  const slide = parse(await zip.file("ppt/slides/slide1.xml").async("string"));
  expect(all(slide, "parsererror")).toHaveLength(0);
  expect(all(slide, "p:sp")).toHaveLength(2);
  expect(all(slide, "p:pic")).toHaveLength(0);
  expect(all(slide, "a:t").map(node => node.textContent)).toEqual(["咖啡开业 <script> &", "11 月 1 日"]);
  const properties = all(slide, "a:rPr")[0];
  expect(properties.getAttribute("sz")).toBe("3600");
  expect(properties.getAttribute("b")).toBe("1");
  expect(properties.getAttribute("i")).toBe("1");
  expect(all(properties, "a:alpha")[0].getAttribute("val")).toBe("25098");
  const transform = all(slide, "a:xfrm")[1];
  expect(transform.getAttribute("rot")).toBe("5400000");
  // A 300x100 box rotated around (40,50) has its OOXML center at (-10,200).
  expect(all(transform, "a:off")[0].getAttribute("x")).toBe(String(-160 * 9525));
  expect(all(transform, "a:off")[0].getAttribute("y")).toBe(String(150 * 9525));
  expect(parse(await zip.file("ppt/slides/slide2.xml").async("string")).documentElement.getAttribute("show")).toBe("0");
  const notes = parse(await zip.file("ppt/notesSlides/notesSlide1.xml").async("string"));
  expect(all(notes, "a:t").map(node => node.textContent)).toEqual(["私有备注", "第二行"]);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.(xml|rels)$/.test(name)) continue;
    const document = parse(await entry.async("string"));
    expect(all(document, "parsererror"), name).toHaveLength(0);
    if (name.endsWith(".rels")) {
      const ownerDir = name === "_rels/.rels" ? "" : posix.dirname(posix.dirname(name));
      for (const relation of all(document, "Relationship")) {
        expect(relation.getAttribute("TargetMode")).not.toBe("External");
        expect(zip.file(posix.normalize(posix.join(ownerDir, relation.getAttribute("Target")))), name).not.toBeNull();
      }
    }
  }
});

it("embeds a shared image once, with independent native picture crop and contain geometry", async () => {
  const document = deck();
  document.pages[0].nodes = ["contain", "cover", "stretch"].map(fit => ({ ...document.pages[0].nodes[0], type: "image", id: fit, fit, assetId: "photo", alt: "Reference", rotation: 0, width: 100, height: 100, style: undefined, text: undefined }));
  document.pages[0].nodes = document.pages[0].nodes.map(({ style: _style, text: _text, ...node }) => node);
  const bytes = await sharp({ create: { width: 200, height: 100, channels: 4, background: "#ff000080" } }).png().toBuffer();
  const images = new Map([["photo", { bytes, width: 200, height: 100, format: "png" }]]);
  const zip = await JSZip.loadAsync(await buildLayoutPptx(document, images));
  expect(Object.keys(zip.files).filter(name => name.startsWith("ppt/media/") && !zip.files[name].dir)).toHaveLength(1);
  const slide = parse(await zip.file("ppt/slides/slide1.xml").async("string")), pictures = all(slide, "p:pic");
  expect(pictures).toHaveLength(3);
  expect(all(pictures[0], "a:ext")[0].getAttribute("cy")).toBe(String(50 * 9525));
  expect(all(pictures[1], "a:srcRect")[0].getAttribute("l")).toBe("25000");
  expect(all(pictures[2], "a:srcRect")).toHaveLength(0);
  expect(all(pictures[2], "a:ext")[0].getAttribute("cy")).toBe(String(100 * 9525));
  await expect(buildLayoutPptx(document)).rejects.toThrow("EXPORT_IMAGE_MISSING");
});

it("refuses heterogeneous slide sizes and oversized output instead of silently rescaling or dropping pages", async () => {
  const document = deck(); document.pages[1].width = 1200;
  await expect(buildLayoutPptx(document)).rejects.toThrow("EXPORT_SLIDE_SIZE_UNSUPPORTED");
  await expect(buildLayoutPptx(deck(), new Map(), { maxBytes: 64 })).rejects.toThrow("EXPORT_RESULT_TOO_LARGE");
});

it("imports editable HTML slides while retaining notes, hidden state, image assets and unsupported-object warnings", async () => {
  const document = deck();
  document.pages[0].nodes.push({ ...base, id: "rotated", type: "text", text: "Rotated", rotation: 15, style: { fontSize: 24, fill: "#112233", fontWeight: "normal", fontStyle: "normal", verticalAlign: "top", align: "left", letterSpacing: 0, lineHeight: 1, fontFamily: "sans" } });
  const image = await sharp({ create: { width: 20, height: 10, channels: 4, background: "#123456" } }).png().toBuffer();
  document.pages[0].nodes.push({ ...base, id: "photo", type: "image", assetId: "photo", alt: "商品图", fit: "contain", rotation: 0, width: 40, height: 20 });
  const bytes = await buildLayoutPptx(document, new Map([["photo", { bytes: image, width: 20, height: 10, format: "png" }]]));
  const result = importPresentationHtml(bytes, { title: "导入样本.pptx" });
  expect(result.content.format).toBe("html-slides");
  expect(result.content.title).toBe("导入样本");
  expect(result.content.pages).toHaveLength(2);
  expect(result.content.pages[0].notes).toBe("私有备注\n第二行");
  expect(result.content.pages[1].hidden).toBe(true);
  const html = result.content.pages[0].html;
  expect(html).toContain("transform:rotate(15deg)");
  expect(inspectHtml(html).assets).toHaveLength(1);
  expect(result.media).toHaveLength(1);
  expect(result.warnings).toContain("PPTX_TEXT_FORMATTING_SIMPLIFIED");
});

it("imports cached native chart data as editable HTML charts and safely escapes table cell text", async () => {
  const bytes = await buildLayoutPptx(deck()), zip = await JSZip.loadAsync(bytes);
  const slidePath = "ppt/slides/slide1.xml", relsPath = "ppt/slides/_rels/slide1.xml.rels";
  const chart = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>季度销售</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:v>收入</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="336699"/></a:solidFill></c:spPr><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>一季度</c:v></c:pt><c:pt idx="1"><c:v>二季度</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>18.5</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
  const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="900" name="Sales"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="9525" y="19050"/><a:ext cx="6096000" cy="3429000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="901" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="1905000"/></a:tblGrid><a:tr h="952500"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>&lt;/td&gt;&lt;script&gt;alert(1)&lt;/script&gt;</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  zip.file(slidePath, (await zip.file(slidePath).async("string")).replace("</p:spTree>", `${frame}${table}</p:spTree>`));
  zip.file(relsPath, (await zip.file(relsPath).async("string")).replace("</Relationships>", '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>'));
  zip.file("ppt/charts/chart1.xml", chart);
  const result = importPresentationHtml(await zip.generateAsync({ type: "nodebuffer" }));
  expect(result.warnings).not.toContain("PPTX_CHART_RELATION_UNSUPPORTED");
  const html = result.content.pages[0].html, data = html.match(/data-chart="([^"]+)"/)?.[1];
  expect(data).toBeTruthy();
  expect(JSON.parse(data.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">"))).toEqual({
    type: "bar", title: "季度销售", labels: ["一季度", "二季度"], series: [{ name: "收入", values: [12, 18.5], color: "#336699" }],
  });
  expect(result.warnings).toContain("PPTX_CHART_STYLE_SIMPLIFIED");
  expect(html).toContain("&lt;/td&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(() => inspectHtml(html)).not.toThrow();
});
