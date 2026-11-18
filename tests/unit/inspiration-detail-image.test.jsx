// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import InspirationDetailImage from "../../src/components/discover/InspirationDetailImage.jsx";

vi.mock("next/image", () => ({ default: function Image({ unoptimized, sizes, ...props }) {
  return createElement("img", { ...props, sizes, "data-unoptimized": String(unoptimized) });
} }));
afterEach(cleanup);

const item = {
  id: "public-one", title: "测试灵感", size: "1024x1536", cover: { type: "asset", assetId: "cover-one" },
  imageUrl: "https://ai-cdn.iamshuaidi.com/letaidraw/inspiration/one/original",
  thumbnailUrl: "https://ai-cdn.iamshuaidi.com/letaidraw/inspiration/one/640.webp",
};

test("shows the cached card thumbnail until the original image has loaded", () => {
  const { container } = render(<InspirationDetailImage item={item} />);
  expect(screen.getByRole("img", { name: item.title }).getAttribute("src")).toBe(item.thumbnailUrl);
  const original = container.querySelector(`img[src="${item.imageUrl}"]`);
  expect(original.getAttribute("fetchpriority")).toBe("high");
  expect(original.dataset.unoptimized).toBe("true");
  expect(original.style.opacity).toBe("0");
  fireEvent.load(original);
  expect(screen.getByRole("img", { name: item.title })).toBe(original);
  expect(original.style.opacity).toBe("");
  expect(container.querySelector(`img[src="${item.thumbnailUrl}"]`)).toBeNull();
});

test("keeps a visible preview on delivery failures and reveals the successful fallback", () => {
  const { container } = render(<InspirationDetailImage item={item} />);
  const original = container.querySelector(`img[src="${item.imageUrl}"]`);
  fireEvent.error(original);
  expect(screen.getByRole("img", { name: item.title }).getAttribute("src")).toBe(item.thumbnailUrl);
  expect(original.getAttribute("src")).toBe("/api/inspiration/public-one/image?delivery=proxy");
  fireEvent.load(original);
  expect(screen.getByRole("img", { name: item.title })).toBe(original);
});

test("renders a built-in original without another Next image optimization request", () => {
  render(<InspirationDetailImage item={{ id: "builtin", title: "内置图", size: "1024x1024", cover: { type: "builtin", file: "sample" } }} />);
  const image = screen.getByRole("img", { name: "内置图" });
  expect(image.getAttribute("src")).toBe("/inspiration/generated/sample.webp");
  expect(image.dataset.unoptimized).toBe("true");
  expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(1);
});

test("shows the next item's thumbnail instead of reusing the previous load state", () => {
  const view = render(<InspirationDetailImage item={item} />);
  fireEvent.load(view.container.querySelector(`img[src="${item.imageUrl}"]`));
  const next = { ...item, id: "public-two", imageUrl: `${item.imageUrl}-two`, thumbnailUrl: `${item.thumbnailUrl}-two` };
  view.rerender(<InspirationDetailImage item={next} />);
  expect(screen.getByRole("img", { name: next.title }).getAttribute("src")).toBe(next.thumbnailUrl);
});
