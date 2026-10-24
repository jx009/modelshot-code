import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { exportFormat } from "../../src/lib/creation/contracts/exports.js";

const run = promisify(execFile);
it.skipIf(process.env.CREATION_NATIVE_RENDER_TESTS !== "true")("exports real semantic/native document PDFs in the isolated child and verifies every page", async () => {
  const { default: sharp } = await import("sharp");
  const generated = await mkdtemp(join(tmpdir(), "creation-document-pdf-"));
  const root = process.env.CREATION_PDF_TEST_OUTPUT_DIR ? resolve(process.env.CREATION_PDF_TEST_OUTPUT_DIR) : generated;
  await mkdir(root, { recursive: true });
  try {
    const runs = text => [{ text }];
    const photo = await sharp({ create: { width: 160, height: 80, channels: 3, background: "#059669" } }).png().toBuffer();
    const semantic = { schemaVersion: 1, kind: "document", title: "Document PDF QA", page: { header: "CREATION REPORT", footer: "INTERNAL REVIEW", pageNumbers: true },
      sections: [{ id: "main", title: "报告", blocks: [
        { id: "title", type: "heading", level: 1, runs: runs("AI 创作工作台 / Export review") },
        { id: "intro", type: "paragraph", runs: [
          { text: "中文报告：", marks: { bold: true, color: "#1d4ed8" } },
          { text: "保留中文、英文、图片和表格。This report checks rich text, pagination and inline images. " },
          { text: "Highlighted text", marks: { highlight: "#fef08a", underline: true } },
        ] },
        { id: "list", type: "list", ordered: true, start: 3, items: [{ id: "li1", runs: runs("Create an editable draft") }, { id: "li2", runs: runs("Review and export the fixed revision") }] },
        { id: "image", type: "image", assetId: "photo", width: 160, height: 80, caption: "Private inline image" },
        { id: "table", type: "table", headerRows: 1, rows: Array.from({ length: 73 }, (_, i) => ({ id: `r${i}`, cells: [
          { id: `a${i}`, runs: runs(i ? `ROW_${String(i).padStart(3, "0")}` : "ITEM HEADER") },
          { id: `b${i}`, runs: runs(i ? `中文内容 ${i}` : "DESCRIPTION") },
          { id: `c${i}`, runs: runs(i ? String(i * 19) : "AMOUNT") },
        ] })) },
        { id: "break", type: "pageBreak" },
        { id: "end", type: "paragraph", runs: runs("END OF DOCUMENT - 完整导出") },
      ] }] };
    const native = toNativeDocumentArtifact(semantic, "pdf-qa");
    const table = Object.values(native.snapshot.tableSource)[0];
    table.tableRows[2].trHeight = { val: { v: 48 }, hRule: 1 };
    table.tableRows[2].tableCells[0].vAlign = 4;
    table.tableRows[2].tableCells[1].vAlign = 3;
    const child = fileURLToPath(new URL("../../src/lib/creation/exports/layout-child.mjs", import.meta.url));
    const preload = new URL("../support/creation-export-test-fonts.mjs", import.meta.url).href;
    const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.SKIA_CANVAS_THREADS = "1";
    await writeFile(join(generated, "asset-0"), photo);
    for (const [name, document] of [["semantic", semantic], ["native", native]]) {
      const input = { document, assets: [{ id: "photo", bytes: photo.length, checksum: createHash("sha256").update(photo).digest("hex") }],
        format: "pdf", exporterVersion: exportFormat("pdf", document.schemaVersion, "document").version };
      await writeFile(join(generated, "input.json"), JSON.stringify(input));
      await run(process.execPath, ["--max-old-space-size=256", "--import", preload, child, generated], { env, timeout: 30000, windowsHide: true });
      const bytes = await readFile(join(generated, "output.bin"));
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      await writeFile(join(root, `${name}.pdf`), bytes);
      await run(process.env.CREATION_PDF_TEST_POPPLER || "pdftoppm", ["-r", "72", "-png", join(root, `${name}.pdf`), join(root, `${name}-page`)], { timeout: 20000, windowsHide: true });
    }
    const { stdout } = await run(process.env.CREATION_PDF_TEST_PYTHON || "python", [fileURLToPath(new URL("../support/verify-creation-document-pdf.py", import.meta.url)), root], { timeout: 15000, windowsHide: true });
    const result = JSON.parse(stdout);
    expect(result.semantic.pages).toBeGreaterThan(2); expect(result.native.pages).toBeGreaterThan(2);
    expect(result.semantic.rows).toBe(72); expect(result.native.rows).toBe(72);
    await writeFile(join(root, "verification.json"), JSON.stringify(result, null, 2));
  } finally { await rm(generated, { recursive: true, force: true }); }
}, 90000);
