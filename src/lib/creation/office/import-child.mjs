import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { importDocument } from "./docx.js";
import { importWorkbook } from "./xlsx.js";
import { importPresentationHtml } from "./pptx-html.js";
import { assertNativeOfficeRuntimeContent } from "../client/native-office-policy.js";
import { officeImportBytes, OFFICE_IMPORT_VERSION } from "./import-policy.js";

const root = resolve(process.argv[2]);
sharp.cache({ memory: 8, files: 0, items: 8 }); sharp.concurrency(1);
const deadline = setTimeout(() => process.exit(1), 30000); deadline.unref();
try {
  if ((await stat(join(root, "input.json"))).size > 4096) throw new Error("OFFICE_INPUT_INVALID");
  const input = JSON.parse(await readFile(join(root, "input.json"), "utf8"));
  const size = (await stat(join(root, "source.bin"))).size;
  if (size > officeImportBytes(input.format) || size !== input.bytes) throw new Error("OFFICE_SOURCE_INVALID");
  const bytes = await readFile(join(root, "source.bin"));
  if (createHash("sha256").update(bytes).digest("hex") !== input.checksum) throw new Error("OFFICE_SOURCE_INVALID");
  const importer = { docx: importDocument, xlsx: importWorkbook, pptx: importPresentationHtml }[input.format];
  if (!importer) throw new Error("OFFICE_FORMAT_UNSUPPORTED");
  const result = importer(bytes, input), media = [];
  let total = 0;
  for (const item of result.media || []) {
    const decoder = sharp(item.bytes, { limitInputPixels: 16_000_000, animated: false, failOn: "warning" });
    // Photos should not expand into large PNGs during an otherwise small import.
    const jpeg = input.format === "pptx" && (await decoder.metadata()).format === "jpeg";
    const pipeline = decoder.rotate();
    const normalized = await (jpeg ? pipeline.jpeg({ quality: 95 }) : pipeline.png({ compressionLevel: 1 })).timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
    if ((total += normalized.data.length) > 32 * 1024 * 1024) throw new Error("OFFICE_MEDIA_LIMIT");
    await writeFile(join(root, "media-" + media.length), normalized.data);
    media.push({ id: item.id, width: normalized.info.width, height: normalized.info.height, bytes: normalized.data.length, checksum: createHash("sha256").update(normalized.data).digest("hex"), contentType: jpeg ? "image/jpeg" : "image/png" });
  }
  if (input.format !== "pptx") assertNativeOfficeRuntimeContent(result.content);
  await writeFile(join(root, "output.json"), JSON.stringify({ version: OFFICE_IMPORT_VERSION, content: result.content, media, warnings: result.warnings || [] }));
} catch (error) {
  const code = /^(?:OFFICE_|CREATION_REFERENCE_|NATIVE_OFFICE_)[A-Z0-9_]+$/.test(error.message || "") ? error.message : "OFFICE_IMPORT_FAILED";
  await writeFile(join(root, "error.json"), JSON.stringify({ code })); process.exitCode = 1;
} finally { clearTimeout(deadline); }
