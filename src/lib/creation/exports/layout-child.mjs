import { readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { exportFormat, exportSupportsKind } from "../contracts/exports.js";
import { validatePosterExport, POSTER_IMAGE_PIXELS } from "./raster-policy.js";
import { validateLayoutPdf } from "./pdf-policy.js";

// Launched only by the isolated export worker, with no database/storage/model
// credentials. Native image decoding and PPTX packaging live in this process.
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
  const raster = format === "png" || format === "jpeg";
  const svg = format === "svg";
  const pdf = format === "pdf";
  if (pdf && document.schemaVersion !== 3) validateLayoutPdf(document);
  if (svg) {
    const { validatePosterSvg } = await import("./svg.js");
    validatePosterSvg(document);
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
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if ((meta.pages || 1) !== 1 || !["png", "jpeg", "webp"].includes(meta.format)) throw new Error("EXPORT_IMAGE_UNSUPPORTED");
    decodedPixels += meta.width * meta.height;
    if ((raster || svg || pdf) && (!Number.isSafeInteger(decodedPixels) || decodedPixels > POSTER_IMAGE_PIXELS)) throw new Error("EXPORT_IMAGE_PIXELS_EXCEEDED");
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
    output = await buildLayoutPdf(document, images);
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
  // 保留真实原因（截断、单行），否则父进程只能看到笼统的 EXPORT_RENDER_FAILED。
  const detail = String(error?.message || error).replace(/\s+/g, " ").slice(0, 300);
  await writeFile(join(root, "error.json"), JSON.stringify({ code, detail }));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
