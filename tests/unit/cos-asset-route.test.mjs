import { beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../../src/lib/http.js";
const mocks = vi.hoisted(() => ({ user: vi.fn(), owned: vi.fn(), delivery: vi.fn(), enqueue: vi.fn(), repair: vi.fn(), after: vi.fn(), stream: vi.fn(), preview: vi.fn() }));
vi.mock("../../src/lib/require-user.js", () => ({ requireUser: mocks.user }));
vi.mock("../../src/lib/domain/assets/service.js", () => ({ ownedAsset: mocks.owned }));
vi.mock("../../src/lib/domain/assets/cos-delivery.js", () => ({ assetDeliveryUrl: mocks.delivery, enqueueCosAsset: mocks.enqueue, repairCosAsset: mocks.repair }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => ({ stream: mocks.stream }) }));
vi.mock("../../src/lib/domain/assets/preview.js", async importOriginal => ({ ...await importOriginal(), imagePreview: mocks.preview }));
vi.mock("next/server", () => ({ after: mocks.after }));
import { GET } from "../../src/app/api/assets/[id]/route.js";
const asset = { id: "asset-route-fixture", contentType: "image/png", checksum: "checksum", bytes: 3, objectKey: "private/asset" };
const request = query => new Request(`http://localhost/api/assets/${asset.id}${query}`);
const context = { params: Promise.resolve({ id: asset.id }) };
beforeEach(() => { mocks.user.mockResolvedValue({ id: "owner" }); mocks.owned.mockResolvedValue(asset); mocks.delivery.mockResolvedValue("https://fixture.cos.ap-hongkong.myqcloud.com/signed"); mocks.stream.mockResolvedValue(new Uint8Array([1, 2, 3])); mocks.preview.mockResolvedValue(new Uint8Array([4, 5])); });

it.each([401, 404])("does not sign any COS URL before authorization succeeds (%s)", async status => {
  if (status === 401) mocks.user.mockRejectedValue(new AppError("UNAUTHORIZED", 401));
  else mocks.owned.mockRejectedValue(new AppError("ASSET_NOT_FOUND", 404));
  expect((await GET(request("?delivery=auto"), context)).status).toBe(status);
  expect(mocks.delivery).not.toHaveBeenCalled(); expect(mocks.stream).not.toHaveBeenCalled();
});
it("redirects authorized image loads without caching bearer URLs", async () => {
  const response = await GET(request("?preview=320&delivery=auto"), context);
  expect(response.status).toBe(307); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-asset-delivery")).toBe("cos");
  expect(mocks.delivery).toHaveBeenCalledWith(asset, 320, { download: false }); expect(mocks.stream).not.toHaveBeenCalled();
});
it.each([null, new Error("cos unavailable")])("serves the canonical preview when COS is cold or unavailable", async outcome => {
  if (outcome instanceof Error) mocks.delivery.mockRejectedValue(outcome); else mocks.delivery.mockResolvedValue(outcome);
  const response = await GET(request("?preview=320&delivery=auto"), context);
  expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5]));
  expect(mocks.after).toHaveBeenCalledOnce();
  await mocks.after.mock.calls[0][0](); expect(mocks.enqueue).toHaveBeenCalledWith(asset.id);
});
it("routes ordinary downloads to COS and retains an explicit proxy fallback", async () => {
  expect((await GET(request(""), context)).status).toBe(307);
  expect((await GET(request("?download=1"), context)).status).toBe(307);
  expect(mocks.delivery).toHaveBeenLastCalledWith(asset, 0, { download: true });
  expect((await GET(request("?delivery=proxy"), context)).status).toBe(200);
  expect(mocks.delivery).toHaveBeenCalledTimes(2);
  await mocks.after.mock.calls[0][0](); expect(mocks.repair).toHaveBeenCalledWith(asset, 0);
});
