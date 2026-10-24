// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WebImageFile from "../../src/components/creation/WebImageFile";
import WebImagePicker from "../../src/components/creation/WebImagePicker";
const mocks = vi.hoisted(() => ({ assets: vi.fn(), selected: [{ assetId: "preview-asset-12345" }] }));
// Browserless adapter: test the resulting data URL and load/error callbacks.
// eslint-disable-next-line @next/next/no-img-element
vi.mock("next/image", () => ({ default: ({ unoptimized: _unoptimized, alt = "", ...props }) => <img {...props} alt={alt} /> }));
vi.mock("../../src/components/ui/Modal", () => ({ default: ({ children, label }) => <div role="dialog" aria-label={label}>{children}</div> }));
vi.mock("../../src/components/studio/AssetLibrary", () => ({ default: ({ onSelect, maxSelection }) => <button onClick={() => onSelect(mocks.selected)}>Choose {maxSelection}</button> }));
vi.mock("../../src/lib/creation/client/web-preview-assets", () => ({ loadWebPreviewAssets: (...args) => mocks.assets(...args) }));
const image = "data:image/webp;base64,UklGRgAAAAAXRUJQ", file = { id: "image", path: "images/a.webp", kind: "asset", assetId: "preview-asset-12345" }, page = { id: "html", path: "pages/index.html", kind: "html" };
beforeEach(() => { mocks.assets.mockReset().mockResolvedValue(new Map([[file.assetId, image]])); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const props = () => ({ file, page, pages: [page, { ...page, id: "about", path: "about.html" }], zh: false, onPage: vi.fn(), onInsert: vi.fn() });
it("loads one bounded image preview and changes insertion destination without fetching the image again", async () => {
  const input = props(), view = render(<WebImageFile {...input} />);
  expect((await screen.findByRole("img")).getAttribute("src")).toBe(image);
  expect(mocks.assets).toHaveBeenCalledOnce(); expect(screen.getByLabelText("Image reference code").value).toContain('../images/a.webp');
  fireEvent.change(screen.getByLabelText("Image destination page"), { target: { value: "about" } }); expect(input.onPage).toHaveBeenCalledWith("about");
  view.rerender(<WebImageFile {...input} page={input.pages[1]} />);
  expect(screen.getByLabelText("Image reference code").value).toContain('src="images/a.webp"'); expect(mocks.assets).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Insert at end of page")); expect(input.onInsert).toHaveBeenCalledOnce();
  const signal = mocks.assets.mock.lastCall[1].signal; view.unmount(); expect(signal.aborted).toBe(true);
});
it("rejects obsolete preview results and cancels loads when the page hides", async () => {
  let resolve; mocks.assets.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const input = props(), view = render(<WebImageFile {...input} />);
  await waitFor(() => expect(mocks.assets).toHaveBeenCalledOnce()); const oldSignal = mocks.assets.mock.lastCall[1].signal;
  const next = { ...file, assetId: "another-asset-12345" }; mocks.assets.mockResolvedValue(new Map([[next.assetId, image]]));
  view.rerender(<WebImageFile {...input} file={next} />); expect(oldSignal.aborted).toBe(true);
  await screen.findByRole("img"); await act(async () => resolve(new Map([[file.assetId, "stale"]])));
  expect(screen.getByRole("img").getAttribute("src")).toBe(image);
  const signal = mocks.assets.mock.lastCall[1].signal;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange"));
  expect(signal.aborted).toBe(true); expect(screen.queryByRole("img")).toBeNull();
});
it("shows a recoverable preview failure and disables insertion while read-only", async () => {
  mocks.assets.mockRejectedValueOnce(new Error("WEB_PREVIEW_ASSET_UNAVAILABLE"));
  render(<WebImageFile {...props()} readOnly />);
  await screen.findByRole("alert"); fireEvent.click(screen.getByText("Retry image preview")); await screen.findByRole("img");
  expect(screen.getByText("Insert at end of page").disabled).toBe(true);
  fireEvent.error(screen.getByRole("img")); await screen.findByRole("alert");
});
it("keeps the picker open after a rejected edit and prevents duplicate or premature close during submission", async () => {
  const onSelect = vi.fn().mockRejectedValueOnce(new Error("WEB_ASSET_CHANGED")), onClose = vi.fn();
  render(<WebImagePicker target={file} zh={false} maxSelection={8} onSelect={onSelect} onClose={onClose} />);
  fireEvent.click(screen.getByText("Choose 1")); await screen.findByRole("alert"); expect(onClose).not.toHaveBeenCalled();
  let finish; onSelect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByText("Choose 1")); fireEvent.click(screen.getByText("Choose 1"));
  expect(onSelect).toHaveBeenCalledTimes(2); expect(screen.getByLabelText("Close image picker").disabled).toBe(true);
  await act(async () => finish()); expect(onClose).toHaveBeenCalledOnce();
});
