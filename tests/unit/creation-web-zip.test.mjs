import { expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { buildWebZip, validateWebArchive } from "../../src/lib/creation/exports/web-zip.js";
const site = () => ({ schemaVersion: 1, kind: "web", title: "咖啡", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "pages/home.html", files: [
  { id: "html", path: "pages/home.html", kind: "html", content: '<!doctype html><link rel="stylesheet" href="../styles/main.css"><h1>咖啡😀</h1><img src="../images/coffee.webp"><script src="../scripts/main.js"></script>' },
  { id: "css", path: "styles/main.css", kind: "css", content: "h1{color:red}" }, { id: "js", path: "scripts/main.js", kind: "js", content: 'throw new Error("MUST_NOT_EXECUTE")' },
  { id: "photo", path: "images/coffee.webp", kind: "asset", assetId: "coffee" },
], assetIds: ["coffee"] });
it("preserves exact source paths and Unicode and converts raster bytes to the promised extension without executing scripts", async () => {
  const bytes = await sharp({ create: { width: 8, height: 4, channels: 4, background: "#aa440080" } }).png().toBuffer();
  const source = site(), original = structuredClone(source);
  source.files.push({ id: "photo-copy", path: "images/coffee.jpg", kind: "asset", assetId: "coffee" });
  const output = await buildWebZip(source, new Map([["coffee", { bytes }]])), zip = await JSZip.loadAsync(output);
  expect(Object.keys(zip.files).sort()).toEqual(source.files.map(file => file.path).sort());
  for (const file of original.files.filter(file => file.kind !== "asset")) expect(await zip.file(file.path).async("string")).toBe(file.content);
  expect((await sharp(await zip.file("images/coffee.webp").async("nodebuffer")).metadata()).format).toBe("webp");
  expect((await sharp(await zip.file("images/coffee.jpg").async("nodebuffer")).metadata()).format).toBe("jpeg");
  expect(source.files.slice(0, original.files.length)).toEqual(original.files);
});
it("rejects unsafe or nonportable file paths before creating an archive", () => {
  for (const name of ["../outside.html", "/absolute.html", "pages/CON.html", "pages/LPT1.html", "pages/trailing."]) {
    const value = site(); value.files[0].path = name; value.entryPath = name;
    expect(() => validateWebArchive(value)).toThrow(/EXPORT_WEB_/);
  }
  for (const file of [{ id: "case", path: "Pages/extra.html", kind: "html", content: "x" }, { id: "file-dir", path: "styles/main.css/child.html", kind: "html", content: "x" }, { id: "wrong-ext", path: "execute.exe", kind: "js", content: "x" }]) {
    const value = site(); value.files.push(file); expect(() => validateWebArchive(value)).toThrow(/EXPORT_WEB_/);
  }
});
it("rejects missing or invalid images rather than silently exporting broken resources", async () => {
  await expect(buildWebZip(site())).rejects.toThrow("EXPORT_IMAGE_UNSUPPORTED");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  await expect(buildWebZip(site(), new Map([["coffee", { bytes: svg }]]))).rejects.toThrow("EXPORT_IMAGE_UNSUPPORTED");
});
it("exports a pure source site without image processing or invented metadata files", async () => {
  const value = site(); value.files = value.files.filter(file => file.kind !== "asset"); value.assetIds = [];
  const zip = await JSZip.loadAsync(await buildWebZip(value));
  expect(Object.keys(zip.files)).toHaveLength(3); expect(zip.file("pages/home.html")).not.toBeNull();
});
