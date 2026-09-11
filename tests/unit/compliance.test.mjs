import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("c2pa-node", () => { throw new Error("Native signing must not load when disabled"); });
import { injectMetadata } from "../../src/lib/compliance.js";

afterEach(() => { vi.unstubAllEnvs(); });

describe("optional image metadata pipeline", () => {
  it("writes disclosure without native signing and resolves uploads under public", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "modelshot-metadata-test-"));
    try {
      vi.spyOn(process, "cwd").mockReturnValue(folder);
      vi.stubEnv("C2PA_ENABLED", "0");
      await mkdir(path.join(folder, "public/uploads"), { recursive: true });
      const target = path.join(folder, "public/uploads/result.png");
      await writeFile(target, await sharp({ create: { width: 32, height: 48, channels: 3, background: "#239b76" } }).png().toBuffer());
      expect(await injectMetadata("/uploads/result.png", { provider: "fake" })).toBe("/uploads/result.png");
      const metadata = await sharp(await readFile(target)).metadata();
      expect(metadata).toMatchObject({ width: 32, height: 48, format: "png" });
      expect(metadata.exif).toBeDefined();
    } finally {
      vi.restoreAllMocks();
      await rm(folder, { recursive: true, force: true });
    }
  });
  it.each(["/uploads/../../.env", "C:/private/key.png", "/tmp/result.png", "/uploads/nested/result.png"])("rejects a path outside generated uploads: %s", async value => {
    await expect(injectMetadata(value)).rejects.toThrow("Invalid generated image path");
  });
});
