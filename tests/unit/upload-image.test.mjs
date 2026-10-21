import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api.js", () => ({ api: mocks.api }));
import { uploadImage } from "../../src/lib/upload-image.js";
import { validateImageFile } from "../../src/lib/studio/error-handler.js";
afterEach(() => vi.unstubAllGlobals());
it.each([10 * 1024 * 1024 + 1, 50 * 1024 * 1024])("accepts %i bytes in browser upload validation", async size => {
  const file = new File(["image"], "image.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  mocks.api.mockResolvedValueOnce({ mode: "proxy" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ assetId: "large-image" }) })));
  expect(validateImageFile(file).valid).toBe(true);
  expect(await uploadImage(file)).toEqual({ assetId: "large-image" });
  expect(mocks.api.mock.calls[0][1].body.bytes).toBe(size);
});
it("rejects uploads above 50 MB before hashing or making requests", async () => {
  const file = { type: "image/png", size: 50 * 1024 * 1024 + 1, arrayBuffer: vi.fn() };
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(uploadImage(file)).rejects.toThrow("50 MB");
  expect(validateImageFile(file, "zh").error.message).toContain("50MB");
  expect(validateImageFile(file, "en").error.message).toContain("50MB");
  expect(file.arrayBuffer).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("uses the existing multipart upload when the server selects proxy mode", async () => {
  mocks.api.mockResolvedValueOnce({ mode: "proxy" });
  const file = new File(["png bytes"], "image.png", { type: "image/png" });
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ assetId: "proxy-image" }) })); vi.stubGlobal("fetch", fetch);
  expect(await uploadImage(file)).toEqual({ assetId: "proxy-image" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("/api/upload"); expect(init.method).toBe("POST");
  expect(init.body.get("file")).toEqual(file);
  expect(mocks.api).toHaveBeenCalledTimes(1);
});
it("sends only file bytes to COS and retries registration, not uploading again", async () => {
  const file = new File(["jpeg bytes"], "source.jpg", { type: "image/jpeg" });
  mocks.api.mockResolvedValueOnce({ mode: "checksum-required" })
    .mockResolvedValueOnce({ mode: "cos", url: "https://cos.example/staging?signature", uploadId: "upload", headers: { "Content-Type": file.type } })
    .mockRejectedValueOnce(new Error("Lost response")).mockResolvedValueOnce({ assetId: "upload" });
  const fetch = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", fetch);
  expect(await uploadImage(file)).toEqual({ assetId: "upload" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain("cos.example"); expect(fetch.mock.calls[0][1]).toMatchObject({ method: "PUT", body: file, credentials: "omit" });
  expect(mocks.api.mock.calls[0][1].body).toEqual({ bytes: file.size, contentType: "image/jpeg" });
  expect(mocks.api.mock.calls[1][1].body).toMatchObject({ bytes: file.size, contentType: "image/jpeg", checksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(mocks.api.mock.calls[2][1].body).toEqual({ uploadId: "upload" });
  expect(mocks.api.mock.calls[3][1].body).toEqual({ uploadId: "upload" });
});
it("never silently uploads to the US after a COS/CORS failure", async () => {
  mocks.api.mockResolvedValue({ mode: "cos", uploadId: "upload", url: "https://cos.example/staging" });
  const fetch = vi.fn(async () => { throw new TypeError("CORS"); }); vi.stubGlobal("fetch", fetch);
  await expect(uploadImage(new File(["image"], "image.png", { type: "image/png" }))).rejects.toThrow("PUT");
  expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.api).toHaveBeenCalledTimes(1);
});
it("preserves COS HTTP rejection status without misreporting it as CORS or registering an asset", async () => {
  mocks.api.mockResolvedValue({ mode: "cos", uploadId: "upload", url: "https://cos.example/staging" });
  const fetch = vi.fn(async () => ({ ok: false, status: 403 })); vi.stubGlobal("fetch", fetch);
  await expect(uploadImage(new File(["image"], "image.png", { type: "image/png" }))).rejects.toMatchObject({ status: 403, message: expect.stringContaining("HTTP 403") });
  expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.api).toHaveBeenCalledTimes(1);
});
it("identifies a PUT timeout without retransmitting or registering an asset", async () => {
  mocks.api.mockResolvedValue({ mode: "cos", uploadId: "upload", url: "https://cos.example/staging" });
  const fetch = vi.fn(async () => { throw new DOMException("Timeout", "TimeoutError"); }); vi.stubGlobal("fetch", fetch);
  await expect(uploadImage(new File(["image"], "image.png", { type: "image/png" }))).rejects.toMatchObject({ message: expect.stringContaining("超时") });
  expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.api).toHaveBeenCalledTimes(1);
});
