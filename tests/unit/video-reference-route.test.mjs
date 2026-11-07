import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/video/reference/[id]/route.js";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), image: vi.fn(), asset: vi.fn(), stream: vi.fn() }));
vi.mock("../../src/lib/domain/studio/video-reference.js", () => ({ videoReferenceOwner: mocks.owner }));
vi.mock("../../src/lib/domain/assets/service.js", () => ({ readOwnedImage: mocks.image, ownedAsset: mocks.asset }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => ({ stream: mocks.stream }) }));
beforeEach(() => { vi.resetAllMocks(); mocks.asset.mockResolvedValue({ contentType: "image/png" }); });

it("serves only the signed owner's image without requiring a browser session", async () => {
  mocks.owner.mockReturnValue("owner");
  mocks.image.mockResolvedValue(Buffer.from("png-bytes"));
  const response = await GET(new Request("https://app.example/api/video/reference/asset?token=signed"), { params: Promise.resolve({ id: "asset" }) });
  expect(mocks.owner).toHaveBeenCalledWith("asset", "signed");
  expect(mocks.image).toHaveBeenCalledWith("owner", "asset");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe("png-bytes");
});

it("does not read an asset when signature verification fails", async () => {
  const { AppError } = await import("../../src/lib/http.js");
  mocks.owner.mockImplementation(() => { throw new AppError("VIDEO_REFERENCE_EXPIRED", 403); });
  const response = await GET(new Request("https://app.example/api/video/reference/asset?token=invalid"), { params: Promise.resolve({ id: "asset" }) });
  expect(response.status).toBe(403);
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.asset).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("supports ranged supplier reads of an owned reference video", async () => {
  mocks.owner.mockReturnValue("owner");
  mocks.asset.mockResolvedValue({ contentType: "video/mp4", bytes: 20, objectKey: "owner/video.mp4" });
  mocks.stream.mockResolvedValue(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }));
  const request = new Request("https://app.example/api/video/reference/asset?token=signed", { headers: { Range: "bytes=2-4" } });
  const response = await GET(request, { params: Promise.resolve({ id: "asset" }) });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 2-4/20");
  expect(mocks.stream).toHaveBeenCalledWith("owner/video.mp4", "bytes=2-4", request.signal);
  expect(mocks.image).not.toHaveBeenCalled();
});
