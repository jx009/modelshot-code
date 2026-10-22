// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import CaseArtwork from "../../src/components/discover/CaseArtwork.jsx";

vi.mock("next/image", () => ({ default: ({ src, alt, unoptimized }) => <img src={typeof src === "string" ? src : src.src} alt={alt} data-unoptimized={String(unoptimized)} /> }));
afterEach(cleanup);

test.each(["chair", "skincare", "sneaker", "perfume", "headphones", "citrus", "interior", "camera"])("fixed artwork %s bypasses the runtime image optimizer", image => {
  render(<CaseArtwork item={{ image, product: "商品图", productEn: "Product", category: "commerce" }} zh />);
  const picture = screen.getByRole("img", { name: "商品图" });
  expect(picture.getAttribute("data-unoptimized")).toBe("true");
  expect(picture.getAttribute("src")).toContain(image);
  expect(picture.getAttribute("src")).not.toContain("/_next/image");
});
