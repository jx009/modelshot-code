import JSZip from "jszip";
import sharp from "sharp";
import { webSchema } from "../contracts/web.js";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";
import { webDeploymentSource } from "../web-deployment.js";

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const fail = code => { throw new Error(code); };
export function validateWebArchive(input) {
  const parsed = webSchema.safeParse(input);
  if (!parsed.success) fail("EXPORT_WEB_INVALID");
  const site = parsed.data, occupied = new Map();
  for (const file of site.files) {
    const parts = file.path.split("/");
    for (const [index, part] of parts.entries()) {
      if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || /[. ]$/.test(part)) fail("EXPORT_WEB_PATH_UNSUPPORTED");
      const path = parts.slice(0, index + 1).join("/"), folded = path.toLowerCase(), directory = index < parts.length - 1;
      const old = occupied.get(folded);
      if (old && (old.path !== path || old.directory !== directory || !directory)) fail("EXPORT_WEB_PATH_COLLISION");
      occupied.set(folded, { path, directory });
    }
    const extension = file.path.split(".").at(-1).toLowerCase();
    const allowed = { html: ["html", "htm"], css: ["css"], js: ["js"], asset: ["png", "jpg", "jpeg", "webp"] }[file.kind];
    if (!allowed.includes(extension)) fail("EXPORT_WEB_EXTENSION_UNSUPPORTED");
  }
  return site;
}

// Export original source as files. Never run generated scripts or render HTML.
// Native image conversion and ZIP compression belong in the isolated child.
export async function buildWebZip(input, images = new Map()) {
  const site = validateWebArchive(input), zip = new JSZip(), converted = new Map();
  const stableDate = new Date("2000-01-01T00:00:00Z");
  let total = 0, decodedPixels = 0;
  for (const file of site.files) {
    let bytes;
    if (file.kind === "asset") {
      const source = images.get(file.assetId);
      if (!source || !Buffer.isBuffer(source.bytes) || source.bytes.length > 50 * 1024 * 1024) fail("EXPORT_IMAGE_UNSUPPORTED");
      const extension = file.path.split(".").at(-1).toLowerCase(), format = extension === "jpg" ? "jpeg" : extension;
      const key = `${file.assetId}:${format}`;
      bytes = converted.get(key);
      if (!bytes) {
        try {
          const image = sharp(source.bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning", animated: false });
          const meta = await image.metadata();
          if ((meta.pages || 1) !== 1 || !["png", "jpeg", "webp"].includes(meta.format)) fail("EXPORT_IMAGE_UNSUPPORTED");
          decodedPixels += meta.width * meta.height;
          if (!Number.isSafeInteger(decodedPixels) || decodedPixels > MAX_IMAGE_PIXELS) fail("EXPORT_IMAGE_PIXELS_EXCEEDED");
          bytes = await image.rotate().toFormat(format, format === "jpeg" ? { quality: 95 } : format === "webp" ? { quality: 90 } : { compressionLevel: 1 }).timeout({ seconds: 15 }).toBuffer();
        } catch (error) {
          if (/^EXPORT_/.test(error.message)) throw error;
          fail("EXPORT_IMAGE_UNSUPPORTED");
        }
        converted.set(key, bytes);
      }
    } else {
      try { bytes = Buffer.from(webDeploymentSource(file, site), "utf8"); }
      catch (error) { fail(error.message === "WEB_REFERENCE_NOT_FOUND" ? "EXPORT_WEB_REFERENCE_NOT_FOUND" : error.message === "WEB_EXTERNAL_REFERENCE_UNSUPPORTED" ? "EXPORT_WEB_EXTERNAL_REFERENCE" : "EXPORT_WEB_SOURCE_INVALID"); }
    }
    total += bytes.length;
    if (total > MAX_INPUT_BYTES) fail("EXPORT_ASSETS_TOO_LARGE");
    zip.file(file.path, bytes, { date: stableDate, createFolders: false, compression: file.kind === "asset" ? "STORE" : "DEFLATE", compressionOptions: { level: 1 } });
  }
  // Avoid generating an oversized complete buffer before noticing the limit.
  const chunks = []; let size = 0;
  await new Promise((resolve, reject) => {
    const stream = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, platform: "UNIX" });
    stream.on("data", chunk => {
      size += chunk.length;
      if (size > EXPORT_MAX_BYTES) { stream.destroy(new Error("EXPORT_RESULT_TOO_LARGE")); return; }
      chunks.push(chunk);
    });
    stream.once("error", reject); stream.once("end", resolve);
  });
  return Buffer.concat(chunks, size);
}
