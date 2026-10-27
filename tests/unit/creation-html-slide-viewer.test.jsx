// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HtmlSlideViewer from "../../src/components/creation/editors/html/HtmlSlideViewer";
import { createSlidePreviewAssets } from "../../src/lib/creation/client/slide-preview-assets";

vi.mock("../../src/components/creation/editors/html/HtmlSlideCard", () => ({ default: ({ page }) => <div data-testid={"preview-" + page.id}>{page.title}</div> }));
vi.mock("../../src/components/creation/editors/html/HtmlEditor", () => ({ default: ({ initialPageId, onPageChange }) => <div data-testid={"editor-" + initialPageId}>inline editor<button onClick={() => onPageChange("b")}>Select page inside editor</button></div> }));
vi.mock("../../src/lib/creation/client/slide-preview-assets", () => ({ createSlidePreviewAssets: vi.fn(() => ({ read: vi.fn(async () => new Map()), clear: vi.fn() })) }));
const observers = [];
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeEach(() => {
  observers.length = 0;
  createSlidePreviewAssets.mockClear();
  vi.stubGlobal("CSS", { escape: value => value });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.elements = []; observers.push(this); }
    observe(element) { this.elements.push(element); }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo); else delete HTMLElement.prototype.scrollTo; });
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
  fireEvent.doubleClick(screen.getByTestId("preview-c"));
  expect(onEdit).toHaveBeenCalledWith("c");
});
it("shows notes and insertion controls for every page in edit mode", async () => {
  const onOperations = vi.fn();
  render(<HtmlSlideViewer content={content} editing onEdit={() => {}} onOperations={onOperations} readOnly />);
  expect(screen.getAllByRole("textbox")).toHaveLength(3);
  expect(screen.getAllByText("New slide")).toHaveLength(3);
  expect(screen.getByLabelText("Slide 2 notes").disabled).toBe(true);
  expect(onOperations).not.toHaveBeenCalled();
});
it("reorders in the continuous viewer using the existing journal operation", () => {
  const onOperations = vi.fn();
  render(<HtmlSlideViewer content={content} onEdit={() => {}} onOperations={onOperations} />);
  fireEvent.keyDown(screen.getByLabelText("Reorder slide 2"), { altKey: true, key: "ArrowUp" });
  expect(onOperations).toHaveBeenCalledExactlyOnceWith([{ op: "reorderHtmlPage", pageId: "b", index: 0 }]);
});
it("keeps the outer active page in sync when the inline editor changes pages", async () => {
  const onPage = vi.fn();
  render(<HtmlSlideViewer content={content} editing onPage={onPage} onOperations={() => true} />);
  await screen.findByTestId("editor-a");
  fireEvent.click(screen.getByText("Select page inside editor"));
  await screen.findByTestId("editor-b");
  expect(screen.queryByTestId("editor-a")).toBeNull();
  expect(onPage).toHaveBeenLastCalledWith("b");
});
it("retains one image cache through browse and edit transitions", async () => {
  const props = { content, onEdit: vi.fn(), onOperations: vi.fn() };
  const view = render(<HtmlSlideViewer {...props} />);
  const cache = createSlidePreviewAssets.mock.results[0].value;
  view.rerender(<HtmlSlideViewer {...props} editing />);
  await screen.findByTestId("editor-a");
  view.rerender(<HtmlSlideViewer {...props} />);
  expect(createSlidePreviewAssets).toHaveBeenCalledOnce(); expect(cache.clear).not.toHaveBeenCalled();
  view.unmount(); expect(cache.clear).toHaveBeenCalledOnce();
});
it("duplicates the latest page content and moves selection after page deletion", async () => {
  const onOperations = vi.fn(() => true), onPage = vi.fn(), onReference = vi.fn();
  const latest = { ...content, pages: content.pages.map(page => ({ ...page, html: "<p>saved latest</p>" })) };
  render(<HtmlSlideViewer content={content} editing onOperations={onOperations} onPage={onPage} editorProps={{ getContent: () => latest, onReference }} />);
  await screen.findByTestId("editor-a");
  fireEvent.click(screen.getAllByLabelText("Duplicate slide")[0]);
  expect(onOperations).toHaveBeenCalledWith([expect.objectContaining({ op: "insertHtmlPage", index: 1, page: expect.objectContaining({ html: "<p>saved latest</p>" }) })]);
  fireEvent.click(screen.getAllByLabelText("Delete slide")[0]);
  expect(onOperations).toHaveBeenLastCalledWith([{ op: "removeHtmlPage", pageId: "a" }]);
  expect(onPage).toHaveBeenLastCalledWith("b");
  fireEvent.click(screen.getAllByLabelText("AI edit slide")[1]);
  expect(onReference).toHaveBeenCalledWith({ pageId: "b", nodeIds: [], label: "b" });
});
