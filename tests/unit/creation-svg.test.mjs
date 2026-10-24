import { expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { buildPosterSvg } from "../../src/lib/creation/exports/svg.js";
import { hasExportSignature } from "../../src/lib/creation/contracts/exports.js";

const poster = nodes => ({ schemaVersion: 1, kind: "poster", title: '海报<&"😀', theme: { name: "Test", primary: "#112233", accent: "#ffee00", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "page", title: "Poster", width: 100, height: 100, background: "#ffffff00", nodes }] });
const shape = (id, changes = {}) => ({ id, type: "shape", name: id, shape: "rectangle", x: 0, y: 0, width: 20, height: 20, fill: "#ff0000", ...changes });
const photo = (id, changes = {}) => ({ id, type: "image", name: id, x: 0, y: 0, width: 40, height: 40, assetId: "asset", fit: "contain", ...changes });

it("keeps text editable, escapes XML markup/control characters and uses supplied measured line positions", () => {
  const node = { id: "title", name: '<script>alert(1)</script>', type: "text", x: 10, y: 20, width: 90, height: 60, rotation: 30, opacity: .5,
    text: '</tspan><script>alert("x")</script>\u0000😀\ud800', style: { fontSize: 20, fontWeight: "bold", fontStyle: "italic", letterSpacing: 2 } };
  const layoutText = vi.fn(value => ({ fontFamily: '"Noto Sans", "Noto Sans CJK SC"', lines: [{ text: value.text, x: 8, y: 21 }, { text: "下一行", x: 0, y: 45 }] }));
  const output = buildPosterSvg(poster([node, shape("hidden", { visible: false })]), new Map(), { layoutText });
  const dom = new JSDOM(output.toString(), { contentType: "image/svg+xml" });
  try {
    const document = dom.window.document;
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.querySelector("script, foreignObject, style, a")).toBeNull();
    expect(document.querySelector("text").getAttribute("font-weight")).toBe("bold");
    expect(document.querySelector("tspan").textContent).toBe(node.text.replace("\u0000", "").toWellFormed());
    expect(document.querySelector("tspan").getAttribute("x")).toBe("8");
    expect(document.querySelector("tspan").getAttribute("y")).toBe("21");
    expect(document.querySelector('g[transform]').getAttribute("transform")).toBe("translate(10 20) rotate(30)");
    expect(document.querySelector('g[transform]').getAttribute("opacity")).toBe("0.5");
    expect(document.querySelectorAll("g[transform]")).toHaveLength(1);
    expect(layoutText).toHaveBeenCalledOnce();
    expect(hasExportSignature(output, "svg")).toBe(true);
    expect(hasExportSignature(output.subarray(0, output.length - 2), "svg")).toBe(false);
    expect(hasExportSignature(Buffer.from("<html></html>"), "svg")).toBe(false);
  } finally { dom.window.close(); }
});

it("renders layer ordering, top-left rotation, alpha and contain image backdrop without external resources", async () => {
  const bytes = await sharp({ create: { width: 8, height: 4, channels: 4, background: "#00ff00" } }).png().toBuffer();
  const images = new Map([["asset", { bytes, width: 8, height: 4, format: "png" }]]);
  const input = poster([photo("image"), shape("blue", { x: 10, y: 10, width: 10, height: 10, fill: "#0000ff" }),
    photo("reuse", { x: 60, y: 60, width: 20, height: 20, fit: "stretch" }),
    shape("rotated", { x: 70, y: 10, width: 20, height: 10, rotation: 90 }),
    shape("alpha", { x: 80, y: 0, width: 20, height: 20, opacity: .5 })]);
  const output = buildPosterSvg(input, images);
  expect(output.toString().match(/data:image\/png;base64/g)).toHaveLength(1);
  expect(output.toString()).not.toMatch(/href="(?:https?:|\/|javascript:)/);
  const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  expect(pixel(5, 5)).toEqual([231, 231, 231, 255]);
  expect(pixel(5, 15)).toEqual([0, 255, 0, 255]);
  expect(pixel(15, 15)).toEqual([0, 0, 255, 255]);
  expect(pixel(65, 20)).toEqual([255, 0, 0, 255]);
  expect(pixel(85, 5)).toEqual([255, 0, 0, 128]);
  expect(pixel(65, 65)).toEqual([0, 255, 0, 255]);
  expect(pixel(50, 50)).toEqual([0, 0, 0, 0]);
});

it("clips cover images and objects to the page, and keeps ellipse/line/rounded rectangle primitives", async () => {
  const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#00ff00" } }).png().toBuffer();
  const output = buildPosterSvg(poster([photo("cover", { x: 90, y: 90, fit: "cover" }), shape("ellipse", { shape: "ellipse" }),
    shape("line", { shape: "line", x: 30 }), shape("round", { x: 60, radius: 512 })]), new Map([["asset", { bytes, width: 8, height: 4, format: "png" }]]));
  const dom = new JSDOM(output.toString(), { contentType: "image/svg+xml" });
  try {
    expect(dom.window.document.querySelector("ellipse")).not.toBeNull();
    expect(dom.window.document.querySelector("line").getAttribute("stroke-width")).toBe("2");
    expect(dom.window.document.querySelector('rect[rx]').getAttribute("rx")).toBe("10");
    expect(dom.window.document.querySelector("use").getAttribute("transform")).toBe("translate(-20 0) scale(10 10)");
    expect(dom.window.document.querySelector('g[clip-path="url(#page)"]')).not.toBeNull();
  } finally { dom.window.close(); }
  expect(await sharp(output).metadata()).toMatchObject({ width: 100, height: 100, format: "svg" });
});

it("enforces schema, bitmap and encoded byte limits and never silently falls back from missing text metrics", () => {
  expect(() => buildPosterSvg({ ...poster([]), kind: "slides" })).toThrow("EXPORT_KIND_UNSUPPORTED");
  expect(() => buildPosterSvg(poster([shape("bad", { fill: 'url(https://example.com)' })]))).toThrow("EXPORT_LAYOUT_INVALID");
  expect(() => buildPosterSvg(poster([photo("missing")]))).toThrow("EXPORT_IMAGE_MISSING");
  const badImage = { bytes: Buffer.from('<svg onload="alert(1)"/>'), width: 8, height: 4, format: "png" };
  expect(() => buildPosterSvg(poster([photo("bad")]), new Map([["asset", badImage]]))).toThrow("EXPORT_IMAGE_UNSUPPORTED");
  expect(() => buildPosterSvg(poster([]), new Map([["asset", { ...badImage, width: 4001, height: 4000 }]]))).toThrow("EXPORT_IMAGE_PIXELS_EXCEEDED");
  expect(() => buildPosterSvg(poster([]), new Map(), { maxBytes: 100 })).toThrow("EXPORT_RESULT_TOO_LARGE");
  const text = poster([{ id: "text", name: "Text", type: "text", x: 0, y: 0, width: 100, height: 30, text: "hello", style: {} }]);
  expect(() => buildPosterSvg(text)).toThrow("EXPORT_FONTS_UNAVAILABLE");
  expect(() => buildPosterSvg(text, new Map(), { layoutText: () => ({ fontFamily: "sans", lines: [{ text: "hello", x: NaN, y: 0 }] }) })).toThrow("EXPORT_TEXT_LAYOUT_INVALID");
  const large = poster([]); large.pages[0].width = 3000; large.pages[0].height = 3000;
  expect(buildPosterSvg(large).length).toBeLessThan(1000); // No 9M-pixel surface.
});
