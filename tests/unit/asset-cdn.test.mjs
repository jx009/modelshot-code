import { expect, it, vi } from "vitest";
import { cdnImageUrl, isCdnImageUrl } from "../../src/lib/asset-cdn.js";

vi.mock("../../src/lib/infra/storage/cos.js", () => ({ cosStorage: vi.fn() }));
import { cosObjectKey, parseCosObjectKey, matchesCosTarget } from "../../src/lib/infra/storage/cos-primary.js";

const config = { bucket: "quizcore-1257337429", region: "ap-guangzhou", prefix: "letaidraw" };
const key = "letaidraw/originals/cmty2jcum000001nyj11arz4x/original/b6043b7f-2abb-44b8-acc6-0980318e5ec9_studio_0.png";

it("stores the object path and produces the exact stable CDN URL", () => {
  expect(cosObjectKey(config, key)).toBe(key);
  expect(cdnImageUrl(key)).toBe(`https://ai-cdn.iamshuaidi.com/${key}`);
  expect(new URL(cdnImageUrl(key)).search).toBe("");
  expect(parseCosObjectKey(key)).toEqual({ bucket: null, region: null, key });
  expect(parseCosObjectKey(cdnImageUrl(key)).key).toBe(key);
  expect(matchesCosTarget(parseCosObjectKey(key), config)).toBe(true);
});

it("retains legacy bucket checks and distinguishes MinIO objects", () => {
  const legacy = parseCosObjectKey(`cos://${config.bucket}/${config.region}/${key}`);
  expect(legacy).toEqual({ bucket: config.bucket, region: config.region, key });
  expect(matchesCosTarget(legacy, { ...config, bucket: "other" })).toBe(false);
  expect(parseCosObjectKey("owner/original/image.png")).toBeNull();
  expect(parseCosObjectKey("owner/upload/image.jpg")).toBeNull();
  expect(parseCosObjectKey("owner/previews/image.webp")).toBeNull();
  expect(parseCosObjectKey("custom/nested/uploads/pending/owner/id").key).toBe("custom/nested/uploads/pending/owner/id");
});

it("encodes path segments and rejects invalid object paths", () => {
  expect(cdnImageUrl("letaidraw/originals/空 格.png")).toBe("https://ai-cdn.iamshuaidi.com/letaidraw/originals/%E7%A9%BA%20%E6%A0%BC.png");
  for (const value of ["", "/file", "../file", "folder/../file", "folder/./file", "folder//file", "file?token=x", "file#anchor", "file\\name", "file\nname"]) {
    expect(() => cdnImageUrl(value)).toThrow("INVALID_CDN_OBJECT_PATH");
  }
});

it("only trusts the exact unsigned HTTPS CDN origin", () => {
  expect(isCdnImageUrl(cdnImageUrl(key))).toBe(true);
  for (const value of ["http://ai-cdn.iamshuaidi.com/image", "https://ai-cdn.iamshuaidi.com.evil.test/image", "https://user@ai-cdn.iamshuaidi.com/image", "https://ai-cdn.iamshuaidi.com:444/image", "https://ai-cdn.iamshuaidi.com/image?q-signature=x", "https://ai-cdn.iamshuaidi.com/"]) {
    expect(isCdnImageUrl(value)).toBe(false);
  }
});
