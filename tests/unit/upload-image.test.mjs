import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api.js", () => ({ api: mocks.api }));
import { uploadImage } from "../../src/lib/upload-image.js";
afterEach(() => vi.unstubAllGlobals());
it("sends only file bytes to COS and retries registration, not uploading again", async () => {
  const file = new File(["jpeg bytes"], "source.jpg", { type: "image/jpeg" });
  mocks.api.mockResolvedValueOnce({ mode: "cos", url: "https://cos.example/staging?signature", uploadId: "upload", headers: { "Content-Type": file.type } })
    .mockRejectedValueOnce(new Error("Lost response")).mockResolvedValueOnce({ assetId: "upload" });
  const fetch = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", fetch);
  expect(await uploadImage(file)).toEqual({ assetId: "upload" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain("cos.example"); expect(fetch.mock.calls[0][1]).toMatchObject({ method: "PUT", body: file, credentials: "omit" });
  expect(mocks.api.mock.calls[0][1].body).toMatchObject({ bytes: file.size, contentType: "image/jpeg", checksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(mocks.api.mock.calls[1][1].body).toEqual({ uploadId: "upload" });
  expect(mocks.api.mock.calls[2][1].body).toEqual({ uploadId: "upload" });
});
it("never silently uploads to the US after a COS/CORS failure", async () => {
  mocks.api.mockResolvedValue({ mode: "cos", uploadId: "upload", url: "https://cos.example/staging" });
  const fetch = vi.fn(async () => { throw new TypeError("CORS"); }); vi.stubGlobal("fetch", fetch);
  await expect(uploadImage(new File(["image"], "image.png", { type: "image/png" }))).rejects.toThrow("PUT");
  expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.api).toHaveBeenCalledTimes(1);
});
