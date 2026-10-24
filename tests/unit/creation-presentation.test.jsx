// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SlidePresentation from "../../src/components/creation/editors/layout/SlidePresentation";
import { presentationPages, presentationStartIndex, presentationKeyIndex, imageFrame } from "../../src/lib/creation/layout-rendering.js";
import { applyWithInverse } from "../../src/lib/creation/layout-history.js";
import { applyLayoutOperations } from "../../src/lib/creation/layout-operations.js";

vi.mock("../../src/components/creation/editors/layout/LayoutCanvas", () => ({ default: ({ page, readOnly, presentation }) => <div data-testid="slide" data-readonly={readOnly} data-presentation={presentation}>{page.id}</div> }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function () { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function () { this.open = false; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const content = { kind: "slides", pages: [
  { id: "a", title: "First", hidden: false, notes: "Private presenter notes" },
  { id: "hidden", title: "Hidden", hidden: true, notes: "Skipped" },
  { id: "b", title: "Last", hidden: false, notes: "" },
] };

it("mounts only the current visible page and keeps notes closed unless explicitly requested", () => {
  const close = vi.fn(); render(<SlidePresentation content={content} startPageId="a" onClose={close} zh={false} />);
  expect(screen.getAllByTestId("slide")).toHaveLength(1);
  expect(screen.getByTestId("slide").textContent).toBe("a");
  expect(screen.getByTestId("slide").getAttribute("data-presentation")).toBe("true");
  expect(screen.queryByText("Private presenter notes")).toBeNull();
  fireEvent.click(screen.getByText("Notes")); expect(screen.getByText("Private presenter notes")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  expect(screen.getAllByTestId("slide")).toHaveLength(1);
  expect(screen.getByTestId("slide").textContent).toBe("b");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Home" });
  expect(screen.getByTestId("slide").textContent).toBe("a");
  fireEvent.click(screen.getByLabelText("End presentation")); expect(close).toHaveBeenCalledOnce();
});

it("presents an explicit empty state when every page is hidden", () => {
  render(<SlidePresentation content={{ ...content, pages: content.pages.map(page => ({ ...page, hidden: true })) }} startPageId="a" onClose={() => {}} zh={false} />);
  expect(screen.queryByTestId("slide")).toBeNull();
  expect(screen.getByText(/All slides are hidden/)).toBeTruthy();
});

it("hiding and undoing a page changes playback without removing its contents", () => {
  const edited = applyWithInverse(content, [{ op: "setPage", pageId: "a", changes: { hidden: true } }]);
  expect(presentationPages(edited.document).map(page => page.id)).toEqual(["b"]);
  expect(edited.document.pages[0].notes).toBe(content.pages[0].notes);
  expect(applyLayoutOperations(edited.document, edited.inverse)).toEqual(content);
  const pages = presentationPages(content);
  expect(presentationStartIndex(pages, "hidden")).toBe(0);
  expect(presentationStartIndex(pages, "b")).toBe(1);
  expect(presentationKeyIndex("ArrowLeft", 0, 2)).toBe(0);
  expect(presentationKeyIndex("PageDown", 1, 2)).toBe(1);
  expect(presentationKeyIndex("End", 0, 2)).toBe(1);
  expect(presentationKeyIndex(" ", 0, 0)).toBeNull();
});

it("uses centered contain/cover geometry consistently across editor and previews", () => {
  const image = { naturalWidth: 200, naturalHeight: 100 }, node = { width: 100, height: 100 };
  expect(imageFrame(image, { ...node, fit: "contain" })).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  expect(imageFrame(image, { ...node, fit: "cover" })).toEqual({ x: -50, y: 0, width: 200, height: 100 });
  expect(imageFrame(image, { ...node, fit: "stretch" })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
});
