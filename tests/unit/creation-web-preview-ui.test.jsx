// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WebPreview from "../../src/components/creation/WebPreview";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
const mocks = vi.hoisted(() => ({ assets: vi.fn(), ids: [], options: [], build: vi.fn(value => `<html><body>${value.entryPath}</body></html>`) }));
vi.mock("../../src/lib/creation/web-preview", () => ({ prepareWebPreviewDocument: (value, options) => { mocks.options.push(options); return { assetIds: mocks.ids, render: images => mocks.build(value, images) }; } }));
vi.mock("../../src/lib/creation/client/web-preview-assets", () => ({ loadWebPreviewAssets: (...args) => mocks.assets(...args) }));
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
  view.rerender(<WebPreview content={content} mode="desktop" pageId="about" zh={false} />);
  expect(signal.aborted).toBe(true);
  await screen.findByTitle("Website preview");
  await act(async () => first(new Map([["asset-coffee-123456", "stale bytes"]])));
  expect(mocks.build).toHaveBeenCalledOnce(); expect(mocks.build.mock.calls[0][0].entryPath).toBe("about.html");
  expect(mocks.build.mock.calls[0][1].size).toBe(0);
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
  const interactive = await screen.findByTitle("Website preview");
  expect(interactive.getAttribute("sandbox")).toBe("allow-scripts");
  expect(interactive.getAttribute("sandbox")).not.toContain("allow-same-origin");
  await waitFor(() => expect(mocks.options.at(-1)).toEqual({ interactive: true }));
  expect(screen.getByText("Scripts run in an isolated preview with network access disabled.")).toBeTruthy();
});
