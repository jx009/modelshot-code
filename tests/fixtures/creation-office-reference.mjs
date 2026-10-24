import JSZip from "jszip";
export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const rels = values => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${values.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`).join("")}</Relationships>`;
const descriptors = {
  docx: ["word/document.xml", "wordprocessingml.document"],
  xlsx: ["xl/workbook.xml", "spreadsheetml.sheet"],
  pptx: ["ppt/presentation.xml", "presentationml.presentation"],
};
export async function officeFile(kind, customize) {
  const zip = new JSZip(), [main, mime] = descriptors[kind];
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${mime}.main+xml"/></Types>`);
  zip.file("_rels/.rels", rels([["main", "officeDocument", main]]));
  if (kind === "docx") zip.file(main, `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>城市咖啡 &amp; 茶😀</w:t><w:tab/><w:t>开业</w:t><w:br/><w:t>11 月 1 日</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>预算</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>6200</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:del><w:p><w:r><w:t>删除文字</w:t></w:r></w:p></w:del></w:body></w:document>`);
  if (kind === "xlsx") {
    zip.file(main, `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="预算" sheetId="7" r:id="second" state="hidden"/><sheet name="汇总" sheetId="2" r:id="first"/></sheets></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", rels([["second", "worksheet", "worksheets/sheet2.xml"], ["first", "worksheet", "worksheets/sheet1.xml"], ["strings", "sharedStrings", "sharedStrings.xml"]]));
    zip.file("xl/sharedStrings.xml", `<sst xmlns="${S}"><si><r><t>咖啡</t></r><r><t>预算</t></r><rPh><t>拼音不重复</t></rPh></si></sst>`);
    zip.file("xl/worksheets/sheet2.xml", `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>4200</v></c></row><row r="2" hidden="1"><c r="A2" t="inlineStr"><is><t>物料</t></is></c><c r="B2"><v>2000</v></c><c r="C2"><f>SUM(B1:B2)</f><v>1</v></c></row></sheetData></worksheet>`);
    zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="${S}"><sheetData><row r="10"><c r="B10" t="b"><v>1</v></c></row></sheetData></worksheet>`);
  }
  if (kind === "pptx") {
    zip.file(main, `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="b"/><p:sldId id="257" r:id="a"/></p:sldIdLst></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", rels([["a", "slide", "slides/slide1.xml"], ["b", "slide", "slides/slide2.xml"]]));
    zip.file("ppt/slides/slide1.xml", `<p:sld xmlns:p="${P}" xmlns:a="${A}" show="0"><p:cSld><a:p><a:r><a:t>第二页</a:t></a:r></a:p></p:cSld></p:sld>`);
    zip.file("ppt/slides/slide2.xml", `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><a:p><a:r><a:t>第一页</a:t></a:r></a:p></p:cSld></p:sld>`);
    zip.file("ppt/slides/_rels/slide2.xml.rels", rels([["notes", "notesSlide", "../notesSlides/notesSlide1.xml"], ["link", "hyperlink", "https://example.invalid/no-fetch", "External"]]));
    zip.file("ppt/notesSlides/notesSlide1.xml", `<p:notes xmlns:p="${P}" xmlns:a="${A}"><a:p><a:r><a:t>讲者备注</a:t></a:r></a:p></p:notes>`);
  }
  await customize?.(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
