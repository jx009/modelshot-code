import { readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { exportFormat, exportSupportsKind } from "../contracts/exports.js";
import { validatePosterExport, POSTER_IMAGE_PIXELS } from "./raster-policy.js";
import { validateLayoutPdf } from "./pdf-policy.js";

// Launched only by the isolated export worker, with no database/storage/model
// credentials. Native image decoding and ZIP creation live in this process.
sharp.cache({ memory: 8, files: 0, items: 8 }); sharp.concurrency(1);
const root = resolve(process.argv[2]);
// Survives loss of the parent process. Container memory/CPU limits are still
// required because JS heap limits do not constrain sharp's native allocations.
const deadline = setTimeout(() => process.exit(1), 120000);
deadline.unref();
async function convert(input) {
  if (input.probePdf) {
    const { probePdfBackend } = await import("./raster.js");
    await probePdfBackend(); return;
  }
  if (input.probeHtml) {
    const { probeHtmlBackend } = await import("./html.js"); await probeHtmlBackend(); return;
  }
  if (input.probeRaster) {
    const { probeRasterBackend } = await import("./raster.js");
    await probeRasterBackend();
    return;
  }
  const { document, assets, format } = input;
  const descriptor = exportFormat(format, document?.schemaVersion ?? 1, document?.kind);
  if (!descriptor) throw new Error("EXPORT_SOURCE_FORMAT_UNSUPPORTED");
  if (input.exporterVersion != null && descriptor.version !== input.exporterVersion) throw new Error("EXPORT_VERSION_UNSUPPORTED");
  if (!exportSupportsKind(descriptor, document?.kind)) throw new Error("EXPORT_KIND_UNSUPPORTED");
  const imported = document.snapshot?.custom?.modelshot?.officeImport;
  if (imported && format === imported.format && ["docx", "xlsx"].includes(format)) {
    if (!input.original || input.original.bytes > 4 * 1024 * 1024 || (await stat(join(root, "original.bin"))).size !== input.original.bytes) throw new Error("EXPORT_SOURCE_INTEGRITY_FAILED");
    const bytes = await readFile(join(root, "original.bin"));
    if (createHash("sha256").update(bytes).digest("hex") !== input.original.checksum) throw new Error("EXPORT_SOURCE_INTEGRITY_FAILED");
    try {
      const output = format === "docx" ? await (await import("../office/docx.js")).patchDocument(bytes, document) : await (await import("../office/xlsx.js")).patchWorkbook(bytes, document);
      await writeFile(join(root, "output.bin"), output); return;
    } catch (error) {
      if (/^OFFICE_/.test(error.code || error.message)) throw new Error("EXPORT_OFFICE_RANGE_UNSUPPORTED");
      throw error;
    }
  }
  // Other formats export the visible projection, never reconstruct the OOXML
  // original. Its metadata is not a document layout feature.
  if (imported) delete document.snapshot.custom.modelshot.officeImport;
  const raster = format === "png" || format === "jpeg";
  const svg = format === "svg";
  const pdf = format === "pdf";
  if (format === "markdown") {
    if (descriptor.sourceSchemaVersion === 2) {
      const { parseNativeDocumentForDocx } = await import("./native-docx-model.js");
      parseNativeDocumentForDocx(document);
    } else {
      const { validateMarkdownDocument } = await import("./markdown.js");
      validateMarkdownDocument(document);
    }
  }
  if (pdf && document.schemaVersion !== 3) {
    if (descriptor.kind === "document") {
      const { documentPdfModel } = await import("./document-pdf-model.js");
      documentPdfModel(document);
    } else validateLayoutPdf(document);
  }
  if (svg) {
    const { validatePosterSvg } = await import("./svg.js");
    validatePosterSvg(document);
  }
  if (format === "zip") {
    const { validateWebArchive } = await import("./web-zip.js");
    validateWebArchive(document);
  }
  if (raster && document.schemaVersion !== 3) validatePosterExport(document, format);
  if (!Array.isArray(assets) || assets.length > 100 || assets.reduce((sum, asset) => sum + asset.bytes, 0) > 100 * 1024 * 1024) throw new Error("EXPORT_ASSETS_TOO_LARGE");
  const images = new Map();
  let outputBytes = 0, decodedPixels = 0;
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index], path = join(root, `asset-${index}`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 50 * 1024 * 1024 || (await stat(path)).size !== asset.bytes) throw new Error("EXPORT_ASSETS_TOO_LARGE");
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== asset.checksum) throw new Error("EXPORT_ASSET_INTEGRITY_FAILED");
    if (format === "zip") { images.set(asset.id, { bytes }); continue; }
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if ((meta.pages || 1) !== 1 || !["png", "jpeg", "webp"].includes(meta.format)) throw new Error("EXPORT_IMAGE_UNSUPPORTED");
    decodedPixels += meta.width * meta.height;
    if ((raster || svg || pdf || format === "markdown") && (!Number.isSafeInteger(decodedPixels) || decodedPixels > POSTER_IMAGE_PIXELS)) throw new Error("EXPORT_IMAGE_PIXELS_EXCEEDED");
    const imageFormat = meta.format === "jpeg" ? "jpeg" : "png";
    const transformed = image.rotate();
    const result = await (imageFormat === "jpeg" ? transformed.jpeg({ quality: 95 }) : transformed.png({ compressionLevel: 1 })).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
    outputBytes += result.data.length;
    if (outputBytes > 100 * 1024 * 1024) throw new Error("EXPORT_ASSETS_TOO_LARGE");
    images.set(asset.id, { bytes: result.data, width: result.info.width, height: result.info.height, format: imageFormat });
  }
  let output;
  if (document.schemaVersion === 3) {
    const { renderHtmlArtifact } = await import("./html.js");
    output = await renderHtmlArtifact(document, images, format);
  } else if (pdf) {
    const { probePdfBackend, buildLayoutPdf } = await import("./raster.js");
    await probePdfBackend();
    output = descriptor.kind === "document" ? await (await import("./document-pdf.js")).buildDocumentPdf(document, images) : await buildLayoutPdf(document, images);
  } else if (svg) {
    const { buildPosterSvg } = await import("./svg.js");
    let layoutText;
    if (document.pages.some(page => page.nodes.some(node => node.visible !== false && node.type === "text"))) {
      const { probeRasterBackend, measureSvgText } = await import("./raster.js");
      await probeRasterBackend(); layoutText = measureSvgText;
    }
    output = buildPosterSvg(document, images, { layoutText });
  } else if (raster) {
    const { probeRasterBackend, buildPosterRaster } = await import("./raster.js");
    await probeRasterBackend();
    output = await buildPosterRaster(document, images, format);
  } else if (format === "zip") {
    const { buildWebZip } = await import("./web-zip.js");
    output = await buildWebZip(document, images);
  } else if (format === "markdown") {
    if (descriptor.sourceSchemaVersion === 2) {
      const { buildNativeDocumentMarkdown } = await import("./native-markdown.js");
      output = await buildNativeDocumentMarkdown(document, images);
    } else {
      const { buildDocumentMarkdown } = await import("./markdown.js");
      output = await buildDocumentMarkdown(document, images);
    }
  } else if (format === "docx") {
    if (descriptor.sourceSchemaVersion === 2) {
      const { buildNativeDocumentDocx } = await import("./native-docx.js");
      output = await buildNativeDocumentDocx(document, images);
    } else {
      const { buildDocumentDocx } = await import("./docx.js");
      output = await buildDocumentDocx(document, images);
    }
  } else if (format === "xlsx") {
    if (descriptor.sourceSchemaVersion === 2) {
      const { buildNativeWorkbookXlsx } = await import("./native-xlsx.js");
      output = await buildNativeWorkbookXlsx(document);
    } else {
      const { buildWorkbookXlsx } = await import("./xlsx.js");
      output = await buildWorkbookXlsx(document);
    }
  } else {
    const { buildLayoutPptx } = await import("./pptx.js");
    output = await buildLayoutPptx(document, images);
  }
  await writeFile(join(root, "output.bin"), output);
}
try {
  if ((await stat(join(root, "input.json"))).size > 3 * 1024 * 1024) throw new Error("EXPORT_INPUT_TOO_LARGE");
  await convert(JSON.parse(await readFile(join(root, "input.json"), "utf8")));
} catch (error) {
  const code = typeof error.message === "string" && /^EXPORT_[A-Z_]+$/.test(error.message) ? error.message : "EXPORT_RENDER_FAILED";
  await writeFile(join(root, "error.json"), JSON.stringify({ code }));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
