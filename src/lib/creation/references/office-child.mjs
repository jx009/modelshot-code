import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { extractOfficeReference } from "./office-text.js";
import { REFERENCE_OFFICE_BYTES, REFERENCE_READER_VERSION } from "../reference-policy.js";

const root = resolve(process.argv[2]);
const deadline = setTimeout(() => process.exit(1), 20000); deadline.unref();
try {
  if ((await stat(join(root, "input.json"))).size > 1024) throw new Error("CREATION_REFERENCE_INVALID");
  const meta = JSON.parse(await readFile(join(root, "input.json"), "utf8"));
  if (meta.version !== REFERENCE_READER_VERSION || !Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || meta.bytes > REFERENCE_OFFICE_BYTES || (await stat(join(root, "source.bin"))).size !== meta.bytes) throw new Error("CREATION_REFERENCE_INVALID");
  const bytes = await readFile(join(root, "source.bin"));
  if (createHash("sha256").update(bytes).digest("hex") !== meta.checksum) throw new Error("CREATION_REFERENCE_INTEGRITY_FAILED");
  const result = extractOfficeReference(bytes, meta.fileType);
  await writeFile(join(root, "output.json"), JSON.stringify(result));
} catch (error) {
  const code = /^CREATION_REFERENCE_[A-Z_]+$/.test(error.message) ? error.message : "CREATION_REFERENCE_EXTRACT_FAILED";
  await writeFile(join(root, "error.json"), JSON.stringify({ code })); process.exitCode = 1;
} finally { clearTimeout(deadline); }
