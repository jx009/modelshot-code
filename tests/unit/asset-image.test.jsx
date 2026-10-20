// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AssetImage from "../../src/components/studio/AssetImage.jsx";
import { assetDeliveryEpoch, consumeAssetDelivery, setAssetDeliveryUser } from "../../src/lib/studio/asset-delivery.js";

vi.mock("next/image", () => ({ default: ({ unoptimized, fill, ...props }) => <img {...props} /> }));
afterEach(() => { cleanup(); setAssetDeliveryUser(null); });

it("renders the direct COS preview then falls back once without a retry loop", () => {
  setAssetDeliveryUser("owner");
  const url = "https://fixture-1250000000.cos.ap-hongkong.myqcloud.com/private/320.webp?signature=fixture";
  consumeAssetDelivery({ assetDelivery: { userId: "owner", expiresAt: Date.now() + 60000, items: [{ assetId: "fixture", variant: 320, url }] } }, assetDeliveryEpoch());
  const onError = vi.fn();
  render(<AssetImage src="/api/assets/fixture?preview=320" alt="preview" onError={onError} />);
  const image = screen.getByAltText("preview");
  expect(image.getAttribute("src")).toBe(url);
  expect(image.getAttribute("crossorigin")).toBe("anonymous");
  fireEvent.error(image);
  expect(image.getAttribute("src")).toBe("/api/assets/fixture?preview=320&delivery=proxy");
  expect(onError).not.toHaveBeenCalled();
  fireEvent.error(image);
  expect(onError).toHaveBeenCalledOnce();
  expect(image.getAttribute("src")).toBe("/api/assets/fixture?preview=320&delivery=proxy");
});
