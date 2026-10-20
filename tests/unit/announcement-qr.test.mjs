import { expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("../../src/lib/infra/storage/cos-config.js", () => ({ getCosConfig: vi.fn() }));
import { uploadAnnouncementQr, announcementQrUrl, qrTarget, QR_MAX_BYTES } from "../../src/lib/server/announcement-qr.js";
const config = { enabled: true, bucket: "test-1250000000", region: "ap-guangzhou", prefix: "letaidraw", secretId: "test", secretKey: "test", signedUrlSeconds: 300 };
const storage = () => ({ assertPrivateBucket: vi.fn(), put: vi.fn(), signedUrl: vi.fn(async key => `https://cos.example/${key}?signature=temporary`) });
it("stores lossless full-sized PNG permanently and signs fresh direct COS URLs", async () => {
  const store = storage();
  const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "white" } }).png().toBuffer();
  const result = await uploadAnnouncementQr(bytes, { config, store });
  expect(result.region).toBe("ap-guangzhou");
  expect(result.qrImage.target).toBe(qrTarget(config));
  const [key, saved, type] = store.put.mock.calls[0];
  expect(key).toBe(`letaidraw/announcements/${result.qrImage.id}.png`);
  expect(type).toBe("image/png");
  expect(await sharp(saved).metadata()).toMatchObject({ width: 300, height: 420, format: "png" });
  const url = await announcementQrUrl(result.qrImage, { config: { ...config, secretKey: "rotated" }, store });
  expect(url.url).toContain(key);
  expect(store.put).toHaveBeenCalledTimes(1);
  await expect(announcementQrUrl(result.qrImage, { config: { ...config, bucket: "different" }, store })).rejects.toMatchObject({ code: "QR_STORAGE_CHANGED" });
});
it("rejects disabled COS, excessive uploads, malformed images and arbitrary object paths", async () => {
  const store = storage();
  await expect(uploadAnnouncementQr(Buffer.from("invalid"), { config: { ...config, enabled: false }, store })).rejects.toMatchObject({ code: "COS_NOT_ENABLED" });
  await expect(uploadAnnouncementQr(Buffer.alloc(QR_MAX_BYTES + 1), { config, store })).rejects.toMatchObject({ code: "QR_IMAGE_TOO_LARGE" });
  for (const content of ["not an image", '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>']) {
    await expect(uploadAnnouncementQr(Buffer.from(content), { config, store })).rejects.toMatchObject({ code: "QR_IMAGE_INVALID" });
  }
  await expect(announcementQrUrl({ id: "../../assets/private.png", target: qrTarget(config) }, { config, store })).rejects.toMatchObject({ code: "QR_IMAGE_NOT_FOUND" });
  expect(store.put).not.toHaveBeenCalled(); expect(store.signedUrl).not.toHaveBeenCalled();
});
