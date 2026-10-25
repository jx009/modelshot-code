// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HtmlSlidePresentation from "../../src/components/creation/editors/html/HtmlSlidePresentation";

vi.mock("@/lib/creation/client/web-preview-assets", () => ({ createWebPreviewAssetLoader: () => async () => new Map() }));
vi.mock("@/lib/creation/html/projection", () => ({ projectHtml: page => page.html }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function () { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function () { this.open = false; });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const content = { title: "Launch", kind: "slides", theme: {}, pages: Array.from({ length: 8 }, (_, index) => ({ id: "slide-" + index, title: "Slide " + index, width: 1280, height: 720, html: "<h1>Slide</h1>", notes: "Private note " + index, hidden: index === 2 })) };

it("retains preloaded frame identities across navigation and never shows private notes on the audience screen", async () => {
  const close = vi.fn(); render(<HtmlSlidePresentation content={content} startPageId="slide-0" onClose={close} zh={false} />);
  const dialog = screen.getByRole("dialog"), first = screen.getByTitle("Slide 0"), next = screen.getByTitle("Slide 1");
  expect(dialog.querySelectorAll("iframe")).toHaveLength(4);
  expect(screen.queryByText("Private note 0")).toBeNull();
  expect(screen.queryByTitle("Slide 2")).toBeNull();
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  expect(screen.getByTitle("Slide 0")).toBe(first);
  expect(screen.getByTitle("Slide 1")).toBe(next);
  expect(next.closest(".cw-slide-slot").getAttribute("aria-hidden")).toBe("false");
  fireEvent.load(next);
  fireEvent.keyDown(next.contentDocument.body, { key: "ArrowRight" });
  expect(screen.getByTitle("Slide 3").closest(".cw-slide-slot").getAttribute("aria-hidden")).toBe("false");
  fireEvent.keyDown(dialog, { key: "End" });
  expect(screen.getByTitle("Slide 7").closest(".cw-slide-slot").getAttribute("aria-hidden")).toBe("false");
  fireEvent.keyDown(dialog, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("status")?.textContent).not.toContain("failed"));
});

it("keeps presentation usable when the speaker popup is blocked", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  render(<HtmlSlidePresentation content={content} startPageId="slide-0" onClose={() => {}} zh={false} />);
  fireEvent.click(screen.getByLabelText("Speaker window"));
  expect(screen.getByText(/Allow popups/)).toBeTruthy();
  expect(screen.queryByText("Private note 0")).toBeNull();
  fireEvent.click(screen.getByLabelText("Next slide"));
  expect(screen.getByTitle("Slide 1").closest(".cw-slide-slot").getAttribute("aria-hidden")).toBe("false");
  await waitFor(() => expect(window.open).toHaveBeenCalledOnce());
});

it("renders an explicit empty state for a deck whose pages are all hidden", async () => {
  render(<HtmlSlidePresentation content={{ ...content, pages: content.pages.map(page => ({ ...page, hidden: true })) }} onClose={() => {}} zh={false} />);
  expect(screen.getByText(/All slides are hidden/)).toBeTruthy();
  expect(screen.getByLabelText("Next slide").disabled).toBe(true);
  await waitFor(() => expect(document.querySelectorAll(".cw-html-presentation iframe")).toHaveLength(0));
});

it("keeps speaker notes private and synchronizes speaker navigation with the audience", async () => {
  const popupHost = document.createElement("iframe"); document.body.append(popupHost);
  const win = popupHost.contentWindow;
  win.ResizeObserver = window.ResizeObserver;
  const close = vi.spyOn(win, "close").mockImplementation(() => {});
  vi.spyOn(window, "open").mockReturnValue(win);
  const view = render(<HtmlSlidePresentation content={content} startPageId="slide-0" onClose={() => {}} zh={false} />);
  fireEvent.click(screen.getByLabelText("Speaker window"));
  await waitFor(() => expect(win.document.querySelector(".sp-notes")?.textContent).toBe("Private note 0"));
  expect(screen.queryByText("Private note 0")).toBeNull();
  const speakerNext = [...win.document.querySelectorAll("footer button")].find(button => button.textContent === "Next");
  fireEvent.click(speakerNext);
  expect(win.document.querySelector(".sp-notes").textContent).toBe("Private note 1");
  expect(screen.getByTitle("Slide 1").closest(".cw-slide-slot").getAttribute("aria-hidden")).toBe("false");
  view.unmount(); expect(close).toHaveBeenCalledOnce(); popupHost.remove();
});
