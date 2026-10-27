import { expect, it } from "vitest";
import JSZip from "jszip";
import { openOfficeZip } from "../../src/lib/creation/references/office-zip.js";
import { officeImportBytes } from "../../src/lib/creation/office/import-policy.js";

it("permits a larger PPT archive without enlarging the reference extractor default", async () => {
  const zip = new JSZip();
  zip.file("ppt/media/photo.bin", Buffer.alloc(5 * 1024 * 1024));
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  expect(() => openOfficeZip(bytes)).toThrow("CREATION_REFERENCE_ARCHIVE_INVALID");
  expect(openOfficeZip(bytes, { maxBytes: officeImportBytes("pptx") }).read("ppt/media/photo.bin")).toHaveLength(5 * 1024 * 1024);
});

it("retains per-entry decompression limits even within the larger upload allowance", async () => {
  const zip = new JSZip();
  zip.file("ppt/media/oversized.bin", Buffer.alloc(8 * 1024 * 1024 + 1));
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  expect(() => openOfficeZip(bytes, { maxBytes: officeImportBytes("pptx") })).toThrow("CREATION_REFERENCE_ARCHIVE_INVALID");
});
