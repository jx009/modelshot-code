import { afterEach, expect, it, vi } from "vitest";
import { extractReferenceInProcess } from "../../src/lib/domain/creation/reference-process.js";
import { officeFile } from "../fixtures/creation-office-reference.mjs";

afterEach(() => vi.unstubAllEnvs());
it("runs real DOCX/XLSX/PPTX extraction in bounded child processes", async () => {
  vi.stubEnv("CREATION_REFERENCE_ISOLATED", "true");
  for (const kind of ["docx", "xlsx", "pptx"]) {
    const result = await extractReferenceInProcess(await officeFile(kind), kind);
    expect(result.readerVersion).toBe("office-reference-1");
    expect(result.text.length).toBeGreaterThan(20); expect(result.limitations.length).toBeGreaterThan(0);
  }
});
it("refuses an ordinary host, propagates child rejection and kills timed-out work", async () => {
  const bytes = await officeFile("docx");
  vi.stubEnv("CREATION_REFERENCE_ISOLATED", "false");
  await expect(extractReferenceInProcess(bytes, "docx")).rejects.toThrow("CREATION_REFERENCE_READER_UNAVAILABLE");
  vi.stubEnv("CREATION_REFERENCE_ISOLATED", "true");
  await expect(extractReferenceInProcess(Buffer.from("not a zip"), "docx")).rejects.toThrow("CREATION_REFERENCE_ARCHIVE_INVALID");
  await expect(extractReferenceInProcess(bytes, "docx", { timeoutMs: 1 })).rejects.toThrow("CREATION_REFERENCE_EXTRACT_TIMEOUT");
  const abort = new AbortController(); abort.abort(new Error("cancelled before spawn"));
  await expect(extractReferenceInProcess(bytes, "docx", { signal: abort.signal })).rejects.toThrow("cancelled before spawn");
});
