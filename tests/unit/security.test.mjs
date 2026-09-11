import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { sealCredential, openCredential } from "../../src/lib/domain/identity/credentials.js";
import { normalizeImage, assetId } from "../../src/lib/domain/assets/service.js";
import { isPublicAddress, downloadProviderImage } from "../../src/lib/infra/storage/download.js";
import { toFileObject, toInlineData } from "../../src/lib/ai/adapters/base.js";
import { passwordSchema } from "../../src/lib/domain/identity/verification.js";
import { readJson } from "../../src/lib/http.js";
import { z } from "zod";

afterEach(() => vi.unstubAllEnvs());

describe("credential encryption", () => {
  it("binds ciphertext to owner, supplier, record and key version", () => {
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    const identity = { id: "credential-1", userId: "user-1", provider: "openai", status: "active" };
    const sealed = { ...identity, ...sealCredential("provider-secret-1234", identity) };
    expect(openCredential(sealed)).toBe("provider-secret-1234");
    for (const changed of [{ userId: "user-2" }, { provider: "gemini" }, { id: "credential-2" }, { status: "revoked" }]) {
      expect(() => openCredential({ ...sealed, ...changed })).toThrow();
    }
    vi.stubEnv("ENCRYPTION_KEY_VERSION", "2");
    vi.stubEnv("ENCRYPTION_KEY_1", "ab".repeat(32));
    vi.stubEnv("ENCRYPTION_KEY", "cd".repeat(32));
    expect(openCredential(sealed)).toBe("provider-secret-1234");
    const rotated = { ...identity, ...sealCredential(openCredential(sealed), identity) };
    expect(rotated.keyVersion).toBe("2");
    expect(openCredential(rotated)).toBe("provider-secret-1234");
  });
});

it("validates actual image bytes, strips metadata and rejects forged MIME", async () => {
  const jpeg = await sharp({ create: { width: 32, height: 48, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const normalized = await normalizeImage(jpeg, "image/jpeg");
  const meta = await sharp(normalized.data).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(["png", 48, 32]);
  expect(meta.exif).toBeUndefined();
  await expect(normalizeImage(jpeg, "image/png")).rejects.toThrow("INVALID_IMAGE_TYPE");
  await expect(normalizeImage(Buffer.from("not an image"))).rejects.toThrow("INVALID_IMAGE");
  const tooManyPixels = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "white" } }).png().toBuffer();
  await expect(normalizeImage(tooManyPixels)).rejects.toThrow("INVALID_IMAGE");
});

it.each(["/../../.env", "/uploads/image.png", "https://example.com/x.png", "http://127.0.0.1/x", "data:image/png;base64,aGVsbG8="])("blocks unowned image reference %s", async value => {
  expect(() => assetId(value)).toThrow();
  await expect(toFileObject(value)).rejects.toThrow();
  await expect(toInlineData(value)).rejects.toThrow();
});

it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "100.64.0.1"])("rejects nonpublic IP %s", address => {
  expect(isPublicAddress(address)).toBe(false);
});

it("rejects unsafe URLs and DNS answers before opening connections", async () => {
  expect(isPublicAddress("8.8.8.8")).toBe(true);
  await expect(downloadProviderImage("https://example.com/image", async () => [{ address: "127.0.0.1", family: 4 }])).rejects.toThrow("UNSAFE_IMAGE_URL");
  await expect(downloadProviderImage("http://example.com/image")).rejects.toThrow("UNSAFE_IMAGE_URL");
  await expect(downloadProviderImage("https://user:password@example.com/image")).rejects.toThrow("UNSAFE_IMAGE_URL");
});

it("enforces bcrypt byte limits and bounded same-origin JSON", async () => {
  expect(passwordSchema.safeParse("密".repeat(25)).success).toBe(false);
  await expect(readJson(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json", origin: "https://other.test" }, body: "{}" }), z.object({}))).rejects.toThrow("CROSS_ORIGIN_REQUEST");
  await expect(readJson(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ large: "x".repeat(100) }) }), z.object({}), 32)).rejects.toThrow("PAYLOAD_TOO_LARGE");
});
