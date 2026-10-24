import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

const run = promisify(execFile);
// Optional native runtime + external PDF parser, deliberately outside the
// normal lightweight unit run. CI must provision the export image's fonts.
it.skipIf(process.env.CREATION_NATIVE_RENDER_TESTS !== "true")("renders real mixed-size searchable PDFs through Skia and the conversion child", async () => {
  const { localFontAliases } = await import("../support/creation-export-test-fonts.mjs");
  const { buildLayoutPdf, buildPosterRaster, probePdfBackend } = await import("../../src/lib/creation/exports/raster.js");
  const { layoutDocumentSchema } = await import("../../src/lib/creation/contracts/layout.js");
  const { exportFormat } = await import("../../src/lib/creation/contracts/exports.js");
  const { probeRasterInProcess, renderLayoutInProcess } = await import("../../src/lib/domain/creation/export-process.js");
  const { default: sharp } = await import("sharp");
  const generated = await mkdtemp(join(tmpdir(), "creation-pdf-qa-"));
  const root = process.env.CREATION_PDF_TEST_OUTPUT_DIR ? resolve(process.env.CREATION_PDF_TEST_OUTPUT_DIR) : generated;
  await mkdir(root, { recursive: true });
  try {
    await probePdfBackend();
    const photo = await sharp({ create: { width: 100, height: 50, channels: 4, background: "#ff000080" } }).png().toBuffer();
    const text = (id, value, x, y, width, height, size) => ({ id, name: id, type: "text", text: value, x, y, width, height, style: { fontSize: size, fontWeight: "bold", fill: "#123456" } });
    const first = { id: "one", title: "One", width: 640, height: 360, background: "#ffffff", notes: "PRIVATE NOTE", nodes: [
      text("title", "咖啡开业", 32, 24, 440, 64, 44), text("label", "PAGE ONE", 34, 110, 300, 40, 24),
      { id: "shape", name: "Shape", type: "shape", shape: "rectangle", x: 40, y: 190, width: 160, height: 100, radius: 16, rotation: 8, opacity: .6, fill: "#00aa88" },
      { id: "photo", name: "Photo", type: "image", assetId: "photo", x: 450, y: 220, width: 80, height: 80, fit: "cover" },
      { id: "omit", name: "Invisible", type: "image", assetId: "missing", visible: false, x: 0, y: 0, width: 10, height: 10 },
    ] };
    const second = { id: "two", title: "Two", width: 321, height: 481, background: "#ffffff", nodes: [
      text("title", "第二页", 20, 30, 280, 64, 40), text("label", "PAGE TWO", 20, 120, 280, 40, 24),
      { id: "circle", name: "Circle", type: "shape", shape: "ellipse", x: 40, y: 250, width: 120, height: 90, fill: "#ee9900" },
    ] };
    const source = layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: "PDF QA", theme: { name: "QA", primary: "#123456", accent: "#ee9900", background: "#ffffff", fontFamily: "sans" }, pages: [first, { ...first, id: "hidden", hidden: true, nodes: [text("hidden", "HIDDEN", 0, 0, 200, 40, 24)] }, second] });
    const images = new Map([["photo", { bytes: photo, width: 100, height: 50 }]]);
    await writeFile(join(root, "slides.pdf"), await buildLayoutPdf(source, images));
    for (const [index, page] of [source.pages[0], source.pages[2]].entries()) {
      const poster = { ...source, kind: "poster", pages: [page] };
      await writeFile(join(root, `expected-${index + 1}.png`), await buildPosterRaster(poster, images, "png"));
    }
    await writeFile(join(root, "poster.pdf"), await buildLayoutPdf({ ...source, kind: "poster", pages: [{ ...source.pages[0], hidden: true }] }, images));
    await run(process.env.CREATION_PDF_TEST_POPPLER || "pdftoppm", ["-r", "96", "-png", join(root, "slides.pdf"), join(root, "pdf-page")], { timeout: 15000, windowsHide: true });
    const { stdout } = await run(process.env.CREATION_PDF_TEST_PYTHON || "python", [fileURLToPath(new URL("../support/verify-creation-pdf.py", import.meta.url)), root], { timeout: 15000, windowsHide: true });
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ pages: 2, searchable_chinese: true });
    await writeFile(join(root, "verification.json"), JSON.stringify(result, null, 2));

    // Exercise the actual child entrypoint/probes/Sharp decoder, with local
    // aliases preloaded only in this test. Production spawn remains unchanged.
    await writeFile(join(generated, "asset-0"), photo);
    const input = { document: source, assets: [{ id: "photo", bytes: photo.length, checksum: createHash("sha256").update(photo).digest("hex") }], format: "pdf", exporterVersion: exportFormat("pdf").version };
    await writeFile(join(generated, "input.json"), JSON.stringify(input));
    const child = fileURLToPath(new URL("../../src/lib/creation/exports/layout-child.mjs", import.meta.url));
    const preload = new URL("../support/creation-export-test-fonts.mjs", import.meta.url).href;
    const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.SKIA_CANVAS_THREADS = "1";
    await run(process.execPath, ["--max-old-space-size=256", "--import", preload, child, generated], { env, timeout: 20000, windowsHide: true });
    const output = await readFile(join(generated, "output.bin"));
    expect(output.subarray(0, 5).toString()).toBe("%PDF-");
    await writeFile(join(root, "child.pdf"), output);
    await run(process.env.CREATION_PDF_TEST_PYTHON || "python", [fileURLToPath(new URL("../support/verify-creation-pdf.py", import.meta.url)), root], { timeout: 15000, windowsHide: true });
    if (localFontAliases.length) {
      // Test aliases must not leak into the production spawn or make a host
      // without its required production fonts advertise healthy PDF support.
      await expect(probeRasterInProcess({ pdf: true })).rejects.toThrow("EXPORT_FONTS_UNAVAILABLE");
    } else {
      await probeRasterInProcess({ pdf: true });
      const store = { stream: async () => new ReadableStream({ start(c) { c.enqueue(photo); c.close(); } }) };
      const converted = await renderLayoutInProcess(source, [{ ...input.assets[0], objectKey: "private/photo" }], { store, signal: AbortSignal.timeout(20000), format: "pdf", exporterVersion: input.exporterVersion });
      expect(converted.subarray(0, 5).toString()).toBe("%PDF-");
    }
  } finally { await rm(generated, { recursive: true, force: true }); }
}, 60000);
