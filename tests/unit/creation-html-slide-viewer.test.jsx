// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HtmlSlideViewer from "../../src/components/creation/editors/html/HtmlSlideViewer";

vi.mock("../../src/components/creation/editors/html/HtmlSlideCard", () => ({ default: ({ page }) => <div data-testid={"preview-" + page.id}>{page.title}</div> }));
const observers = [];
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.elements = []; observers.push(this); }
    observe(element) { this.elements.push(element); }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const content = { pages: ["a", "b", "c"].map(id => ({ id, title: id, width: 1920, height: 1080, html: "<p>" + id + "</p>" })) };
it("renders only nearby slide previews and preserves the selected edit target", async () => {
  const onEdit = vi.fn();
  render(<HtmlSlideViewer content={content} onEdit={onEdit} onOperations={() => true} />);
  await screen.findByTestId("preview-a");
  expect(screen.queryByTestId("preview-b")).toBeNull();
  const near = observers.find(observer => observer.options.rootMargin);
  await act(async () => near.callback(near.elements.map(element => ({ target: element, isIntersecting: element.dataset.slideId === "c" }))));
  await screen.findByTestId("preview-c");
  expect(screen.queryByTestId("preview-a")).toBeNull();
  fireEvent.click(screen.getAllByText("Edit slide")[2]);
  expect(onEdit).toHaveBeenCalledWith("c");
});
it("reorders in the continuous viewer using the existing journal operation", () => {
  const onOperations = vi.fn();
  render(<HtmlSlideViewer content={content} onEdit={() => {}} onOperations={onOperations} />);
  fireEvent.keyDown(screen.getByLabelText("Reorder slide 2"), { altKey: true, key: "ArrowUp" });
  expect(onOperations).toHaveBeenCalledExactlyOnceWith([{ op: "reorderHtmlPage", pageId: "b", index: 0 }]);
});
