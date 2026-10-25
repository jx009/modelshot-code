// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WebPreview from "../../src/components/creation/WebPreview";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
const mocks = vi.hoisted(() => ({ assets: vi.fn(), ids: [], options: [], build: vi.fn(value => `<html><body>${value.entryPath}</body></html>`) }));
vi.mock("../../src/components/creation/InteractiveWebFrame", () => ({ default: ({ srcDoc, width }) => <iframe title="Interactive website preview" data-source={srcDoc} src="https://preview.test/api/creation-preview" sandbox="allow-scripts" style={{ width }} /> }));
vi.mock("../../src/lib/creation/web-preview", () => ({ prepareWebPreviewDocument: (value, options) => { mocks.options.push(options); return { assetIds: mocks.ids, render: images => mocks.build(value, images) }; } }));
vi.mock("../../src/lib/creation/client/web-preview-assets", () => ({ createWebPreviewAssetLoader: () => (...args) => mocks.assets(...args) }));
beforeEach(() => { mocks.ids = []; mocks.options = []; mocks.assets.mockReset().mockResolvedValue(new Map()); });
afterEach(() => { cleanup(); mocks.build.mockClear(); });
const site = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [{ id: "html", path: "index.html", kind: "html", content: "<h1>Coffee</h1>" }, { id: "about", path: "about.html", kind: "html", content: "<p>About</p>" }] });
it("uses one sandboxed preview, changes viewport without recompiling, and previews a chosen HTML file", async () => {
  const content = site(); const view = render(<WebPreview content={content} mode="desktop" zh={false} />);
  const frame = await screen.findByTitle("Website preview");
  expect(frame.getAttribute("sandbox")).toBe(""); expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer"); expect(frame.style.width).toBe("1440px");
  view.rerender(<WebPreview content={content} mode="mobile" zh={false} />);
  expect(screen.getByTitle("Website preview").style.width).toBe("390px"); expect(mocks.build).toHaveBeenCalledOnce();
  view.rerender(<WebPreview content={content} mode="mobile" pageId="about" zh={false} />);
  await waitFor(() => expect(screen.getByTitle("Website preview").getAttribute("srcdoc")).toContain("about.html"));
  expect(mocks.build).toHaveBeenCalledTimes(2); expect(document.querySelectorAll("iframe")).toHaveLength(1);
});
it("cancels obsolete preview builds when rapidly switching files", async () => {
  const content = site(); const view = render(<WebPreview content={content} mode="desktop" pageId="html" zh={false} />);
  view.rerender(<WebPreview content={content} mode="desktop" pageId="about" zh={false} />);
  await screen.findByTitle("Website preview");
  expect(mocks.build).toHaveBeenCalledOnce(); expect(mocks.build.mock.calls[0][0].entryPath).toBe("about.html");
});

it("aborts superseded asset loads and never renders stale resolved bytes", async () => {
  mocks.ids = ["asset-coffee-123456"];
  let first;
  mocks.assets.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }));
  const content = site(), view = render(<WebPreview content={content} mode="desktop" pageId="html" zh={false} />);
  await waitFor(() => expect(mocks.assets).toHaveBeenCalledOnce());
  const signal = mocks.assets.mock.calls[0][1].signal;
  const frame = screen.getByTitle("Website preview");
  expect(frame.getAttribute("srcdoc")).toContain("index.html");
  view.rerender(<WebPreview content={content} mode="desktop" pageId="about" zh={false} />);
  expect(signal.aborted).toBe(true);
  expect(screen.getByTitle("Website preview")).toBe(frame);
  await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("about.html"));
  await act(async () => first(new Map([["asset-coffee-123456", "stale bytes"]])));
  expect(mocks.build).toHaveBeenCalledTimes(2); expect(mocks.build.mock.lastCall[0].entryPath).toBe("about.html");
  expect(mocks.build.mock.lastCall[1].size).toBe(0);
});
it("offers a retry after asset failure and cancels work when the preview unmounts", async () => {
  mocks.assets.mockRejectedValueOnce(new Error("WEB_PREVIEW_ASSET_UNAVAILABLE"));
  const view = render(<WebPreview content={site()} mode="desktop" zh={false} />);
  await screen.findByRole("alert"); expect(screen.queryByTitle("Website preview")).toBeNull();
  fireEvent.click(screen.getByText("Retry preview"));
  await screen.findByTitle("Website preview");
  const signal = mocks.assets.mock.calls[1][1].signal;
  view.unmount(); expect(signal.aborted).toBe(true);
});
it("keeps scripts disabled until the user starts the isolated interactive preview", async () => {
  render(<WebPreview content={site()} mode="desktop" zh={false} />);
  const frame = await screen.findByTitle("Website preview");
  expect(frame.getAttribute("sandbox")).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Run interactive preview" }));
  const interactive = await screen.findByTitle("Interactive website preview");
  expect(interactive.getAttribute("sandbox")).toBe("allow-scripts");
  expect(interactive.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(interactive.hasAttribute("srcdoc")).toBe(false);
  await waitFor(() => expect(mocks.options.at(-1)).toMatchObject({ interactive: true }));
  expect(screen.getByText("Scripts run in an isolated preview with network access disabled.")).toBeTruthy();
});
it.each([false, true])("keeps the mounted preview across tab visibility changes (interactive=%s)", async interactive => {
  render(<WebPreview content={site()} mode="desktop" zh={false} />);
  await screen.findByTitle("Website preview");
  if (interactive) fireEvent.click(screen.getByRole("button", { name: "Run interactive preview" }));
  const title = interactive ? "Interactive website preview" : "Website preview";
  const frame = await screen.findByTitle(title), requests = mocks.assets.mock.calls.length;
  const visibility = vi.spyOn(document, "visibilityState", "get");
  try {
    visibility.mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByTitle(title)).toBe(frame);
    visibility.mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByTitle(title)).toBe(frame);
    expect(mocks.assets).toHaveBeenCalledTimes(requests);
  } finally { visibility.mockRestore(); }
});
it("retains the last preview during a replacement load, failure, and retry", async () => {
  const content = site(), view = render(<WebPreview content={content} mode="desktop" zh={false} />);
  const frame = await screen.findByTitle("Website preview"), src = frame.getAttribute("srcdoc");
  let reject;
  mocks.assets.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  view.rerender(<WebPreview content={content} pageId="about" mode="desktop" zh={false} />);
  await waitFor(() => expect(mocks.assets).toHaveBeenCalledTimes(2));
  expect(screen.getByTitle("Website preview")).toBe(frame); expect(frame.getAttribute("srcdoc")).toBe(src);
  await act(async () => reject(new Error("WEB_PREVIEW_ASSET_UNAVAILABLE")));
  await screen.findByRole("alert"); expect(screen.getByTitle("Website preview")).toBe(frame);
  fireEvent.click(screen.getByText("Retry preview"));
  expect(screen.getByTitle("Website preview")).toBe(frame);
  await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("about.html"));
});
it("stops scripts immediately even when preparing the static replacement is delayed", async () => {
  const view = render(<WebPreview content={site()} mode="desktop" zh={false} />);
  await screen.findByTitle("Website preview");
  fireEvent.click(screen.getByRole("button", { name: "Run interactive preview" }));
  await screen.findByTitle("Interactive website preview");
  mocks.assets.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Stop interactive preview" }));
  expect(screen.queryByTitle("Interactive website preview")).toBeNull();
  expect(screen.getByTitle("Website preview").getAttribute("sandbox")).toBe("");
  await waitFor(() => expect(mocks.assets).toHaveBeenCalledTimes(3));
  const signal = mocks.assets.mock.lastCall[1].signal;
  view.unmount(); expect(signal.aborted).toBe(true);
});
