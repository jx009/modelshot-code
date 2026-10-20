import { afterEach, expect, it, vi } from "vitest";
import { assetDeliveryEpoch, assetImageRequest, consumeAssetDelivery, forgetAssetDelivery, resolveAssetImage, setAssetDeliveryUser } from "../../src/lib/studio/asset-delivery.js";
import { imageUrl, previewUrl } from "../../src/lib/studio/image-url.js";
import { api } from "../../src/lib/client-api.js";

const signed = "https://fixture-1250000000.cos.ap-hongkong.myqcloud.com/private/320.webp?q-signature=fixture";
const src = previewUrl("asset-fixture", 320);
const payload = (changes = {}) => ({ items: [{ assetId: "asset-fixture" }], assetDelivery: { userId: "owner", expiresAt: Date.now() + 60000, items: [{ assetId: "asset-fixture", variant: 320, url: signed }], ...changes } });
afterEach(() => { setAssetDeliveryUser(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses a batch link while returning canonical data without persisting signatures", async () => {
  setAssetDeliveryUser("owner");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload() })));
  const data = await api("/api/library");
  expect(data).toEqual({ items: [{ assetId: "asset-fixture" }] });
  expect(resolveAssetImage(src)).toBe(signed);
  expect(imageUrl("asset-fixture")).toBe("/api/assets/asset-fixture");
  expect(src).toBe("/api/assets/asset-fixture?preview=320");
});

it("resolves expired links through authorized auto delivery and preserves source query parameters", () => {
  setAssetDeliveryUser("owner");
  const now = Date.now();
  consumeAssetDelivery(payload(), assetDeliveryEpoch());
  vi.spyOn(Date, "now").mockReturnValue(now + 55000);
  expect(resolveAssetImage(src + "&dpl=build-fixture")).toBe(src + "&dpl=build-fixture&delivery=auto");
  expect(resolveAssetImage(assetImageRequest(src, "proxy"))).toBe(src + "&delivery=proxy");
});

it("clears private links on user changes and ignores stale in-flight responses", async () => {
  setAssetDeliveryUser("owner");
  const epoch = assetDeliveryEpoch();
  consumeAssetDelivery(payload(), epoch);
  expect(resolveAssetImage(src)).toBe(signed);
  let finish;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const pending = api("/api/library");
  setAssetDeliveryUser("other");
  finish({ ok: true, json: async () => payload() });
  expect(await pending).not.toHaveProperty("assetDelivery");
  setAssetDeliveryUser("owner");
  consumeAssetDelivery(payload(), epoch);
  expect(resolveAssetImage(src)).toBe(src + "&delivery=auto");
});

it("rejects foreign owners, expired payloads and non-COS endpoints", () => {
  setAssetDeliveryUser("owner");
  for (const changes of [
    { userId: "other" }, { expiresAt: Date.now() },
    { items: [{ assetId: "asset-fixture", variant: 320, url: "https://evil.example/image" }] },
    { items: [{ assetId: "asset-fixture", variant: 320, url: signed.replace("https:", "http:") }] },
  ]) {
    consumeAssetDelivery(payload(changes), assetDeliveryEpoch());
    expect(resolveAssetImage(src)).toBe(src + "&delivery=auto");
  }
});

it("forgets failed variants without changing unrelated URLs", () => {
  setAssetDeliveryUser("owner");
  consumeAssetDelivery(payload(), assetDeliveryEpoch());
  forgetAssetDelivery(src);
  expect(resolveAssetImage(src)).toBe(src + "&delivery=auto");
  expect(resolveAssetImage("/studio/scene-03.webp")).toBe("/studio/scene-03.webp");
  expect(resolveAssetImage("https://example.com/image.png")).toBe("https://example.com/image.png");
});
