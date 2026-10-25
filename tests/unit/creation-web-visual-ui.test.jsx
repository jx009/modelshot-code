// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WebVisualEditor from "../../src/components/creation/WebVisualEditor";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { createWebVisualSource } from "../../src/lib/creation/web-visual-source.js";
const mocks = vi.hoisted(() => ({ assets: vi.fn(), source: vi.fn() }));
vi.mock("../../src/lib/creation/client/web-source-worker", () => ({ runWebSourceTask: (...args) => mocks.source(...args) }));
vi.mock("../../src/lib/creation/client/web-preview-assets", () => ({ createWebPreviewAssetLoader: () => (...args) => mocks.assets(...args) }));
const site = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [{ id: "html", path: "index.html", kind: "html", content: '<h1 style="color:rgb(255, 0, 0)">Coffee</h1><p>Other</p>' }, { id: "about", path: "about.html", kind: "html", content: "<p>About</p>" }] });
beforeEach(() => { mocks.assets.mockReset().mockResolvedValue(new Map()); mocks.source.mockReset().mockImplementation(async (_type, payload) => createWebVisualSource(payload.source)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const initialized = new WeakSet();
async function frameReady() {
  const frame = await screen.findByTitle("Visual website editor");
  // jsdom does not load srcdoc; populate the child DOM to test parent handlers.
  if (!initialized.has(frame)) {
    const doc = new DOMParser().parseFromString(frame.getAttribute("srcdoc"), "text/html");
    frame.contentDocument.body.innerHTML = doc.body.innerHTML; fireEvent.load(frame);
    initialized.add(frame);
  }
  await waitFor(() => expect(frame.style.pointerEvents).toBe("auto"));
  return frame;
}
it("creates recoverable drafts without reloading the iframe per keystroke and guards IME and pending selection", async () => {
  const content = site(), onDraft = vi.fn(), onApply = vi.fn(), onError = vi.fn();
  function Harness() { const [pending, setPending] = useState(false); return <WebVisualEditor content={content} mode="desktop" zh={false} hasPending={pending} onDraft={value => { onDraft(value); setPending(true); }} onApply={onApply} onError={onError} />; }
  render(<Harness />); const frame = await frameReady(), src = frame.getAttribute("srcdoc");
  expect(frame.getAttribute("sandbox")).toBe("allow-same-origin"); expect(src).not.toContain("<script");
  fireEvent.click(frame.contentDocument.querySelector("h1"));
  expect(screen.getByLabelText("Element color").value).toBe("#ff0000");
  fireEvent.compositionStart(screen.getByLabelText("Element text"));
  fireEvent.change(screen.getByLabelText("Element text"), { target: { value: "咖啡" } });
  expect(onDraft.mock.lastCall[0].composing).toBe(true); expect(screen.getByText("Apply changes").disabled).toBe(true);
  fireEvent.click(frame.contentDocument.querySelector("p")); expect(screen.getByLabelText("Element text").value).toBe("咖啡");
  fireEvent.compositionEnd(screen.getByLabelText("Element text"));
  fireEvent.change(screen.getByLabelText("Element font size"), { target: { value: "40" } });
  expect(onDraft.mock.lastCall[0]).toMatchObject({ fileId: "html", original: content.files[0].content, composing: false });
  expect(onDraft.mock.lastCall[0].text).toContain("font-size: 40px"); expect(onDraft.mock.lastCall[0].text).toContain("咖啡</h1><p>Other</p>");
  expect(frame.getAttribute("srcdoc")).toBe(src); expect(mocks.assets).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Select text").disabled).toBe(true);
  fireEvent.click(screen.getByText("Apply changes")); expect(onApply).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled();
});
it("selects through the keyboard control, changes width without rebuilding, and cancels stale loads", async () => {
  const content = site(), props = { content, zh: false, onDraft: vi.fn(), onError: vi.fn() };
  const view = render(<WebVisualEditor {...props} mode="desktop" />); const frame = await frameReady();
  expect(screen.queryByRole("complementary", { name: "Element properties" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open element properties" }));
  const option = [...screen.getByLabelText("Select text").options].find(option => option.textContent === "p: Other");
  fireEvent.change(screen.getByLabelText("Select text"), { target: { value: option.value } }); expect(screen.getByLabelText("Element text").value).toBe("Other");
  view.rerender(<WebVisualEditor {...props} mode="mobile" />); expect(frame.style.width).toBe("390px"); expect(mocks.assets).toHaveBeenCalledOnce();
  let resolve; mocks.assets.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  view.rerender(<WebVisualEditor {...props} mode="mobile" pageId="about" />);
  await waitFor(() => expect(mocks.assets).toHaveBeenCalledTimes(2)); const signal = mocks.assets.mock.calls[1][1].signal;
  view.rerender(<WebVisualEditor {...props} mode="mobile" pageId="html" />); expect(signal.aborted).toBe(true);
  await frameReady(); await act(async () => resolve(new Map()));
  expect(screen.getByTitle("Visual website editor").getAttribute("srcdoc")).toContain("Coffee");
  view.unmount(); expect(mocks.assets.mock.lastCall[1].signal.aborted).toBe(true);
});
it("can collapse the inspector without losing unapplied text or rebuilding the preview", async () => {
  const onDraft = vi.fn();
  render(<WebVisualEditor content={site()} zh={false} onDraft={onDraft} />);
  const frame = await frameReady(); fireEvent.click(frame.contentDocument.querySelector("h1"));
  fireEvent.change(screen.getByLabelText("Element text"), { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Close element properties" }));
  expect(screen.queryByLabelText("Element text")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open element properties" }));
  expect(screen.getByLabelText("Element text").value).toBe("Keep this draft");
  expect(screen.getByTitle("Visual website editor")).toBe(frame);
  expect(mocks.source).toHaveBeenCalledOnce(); expect(mocks.assets).toHaveBeenCalledOnce();
});
it("keeps a pending inspector edit when the tab hides and returns", async () => {
  const content = site(), onDraft = vi.fn();
  const view = render(<WebVisualEditor content={content} zh={false} onDraft={onDraft} />);
  const frame = await frameReady(); fireEvent.click(frame.contentDocument.querySelector("h1"));
  fireEvent.change(screen.getByLabelText("Element text"), { target: { value: "Unapplied" } });
  view.rerender(<WebVisualEditor content={content} zh={false} onDraft={onDraft} hasPending />);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByTitle("Visual website editor")).toBe(frame);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByTitle("Visual website editor")).toBe(frame); expect(screen.getByLabelText("Element text").value).toBe("Unapplied");
  expect(screen.getByLabelText("Select text").disabled).toBe(true);
  expect(mocks.assets).toHaveBeenCalledOnce(); expect(mocks.source).toHaveBeenCalledOnce();
});
it("does not resurrect stale inspector text when undo restores identical source in a new revision", async () => {
  const content = site(), props = { zh: false, onDraft: vi.fn() };
  const view = render(<WebVisualEditor {...props} content={content} />);
  const frame = await frameReady(); fireEvent.click(frame.contentDocument.querySelector("h1"));
  fireEvent.change(screen.getByLabelText("Element text"), { target: { value: "Previously edited" } });
  const applied = site(); applied.files[0].content = "<h1>Previously edited</h1>";
  view.rerender(<WebVisualEditor {...props} content={applied} />); await frameReady();
  view.rerender(<WebVisualEditor {...props} content={site()} />); const restored = await frameReady();
  expect(screen.queryByLabelText("Element text")).toBeNull();
  fireEvent.click(restored.contentDocument.querySelector("h1")); expect(screen.getByLabelText("Element text").value).toBe("Coffee");
});
it("cancels an obsolete parse before it can build a preview or load private images", async () => {
  let resolve;
  mocks.source.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const content = site(), view = render(<WebVisualEditor content={content} pageId="html" zh={false} />);
  await waitFor(() => expect(mocks.source).toHaveBeenCalledOnce());
  const signal = mocks.source.mock.calls[0][2].signal;
  view.rerender(<WebVisualEditor content={content} pageId="about" zh={false} />);
  expect(signal.aborted).toBe(true); await frameReady();
  await act(async () => resolve(createWebVisualSource(content.files[0].content)));
  expect(mocks.assets).toHaveBeenCalledOnce();
  expect(screen.getByTitle("Visual website editor").getAttribute("srcdoc")).toContain("About");
});
it("reports worker startup failure without synchronously parsing and permits an explicit retry", async () => {
  mocks.source.mockRejectedValueOnce(new Error("WEB_SOURCE_WORKER_UNAVAILABLE"));
  render(<WebVisualEditor content={site()} zh={false} />);
  await screen.findByRole("alert"); expect(mocks.assets).not.toHaveBeenCalled(); expect(screen.queryByTitle("Visual website editor")).toBeNull();
  fireEvent.click(screen.getByText("Retry")); await frameReady(); expect(mocks.source).toHaveBeenCalledTimes(2);
});
it("patches applied text in place, retains decoded images, and restores new source styles before rebinding selection", async () => {
  const content = site(), assetId = "image-coffee-123456";
  content.assetIds = [assetId];
  content.files.push({ id: "image", kind: "asset", path: "hero.webp", assetId });
  content.files[0].content += '<img src="hero.webp">';
  const loadAssets = vi.fn().mockResolvedValue(new Map([[assetId, "data:image/webp;base64,UklGRgAAAABXRUJQ"]]));
  const props = { zh: false, onDraft: vi.fn(), loadAssets };
  const view = render(<WebVisualEditor {...props} content={content} />);
  const frame = await frameReady(), heading = frame.contentDocument.querySelector("h1"), image = frame.contentDocument.querySelector("img");
  const src = frame.getAttribute("srcdoc"), imageSrc = image.getAttribute("src");
  fireEvent.click(heading); expect(heading.style.getPropertyPriority("outline")).toBe("important");
  const next = { ...content, files: content.files.map(file => file.id === "html" ? { ...file, content: '<h1 style="outline: 4px solid red">New coffee</h1><p>Other</p><img src="hero.webp">' } : file) };
  let resolve;
  loadAssets.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  view.rerender(<WebVisualEditor {...props} content={next} />);
  await waitFor(() => expect(loadAssets).toHaveBeenCalledTimes(2));
  expect(screen.getByTitle("Visual website editor")).toBe(frame); expect(heading.textContent).toBe("Coffee");
  expect(frame.style.pointerEvents).toBe("none");
  fireEvent.click(heading); expect(screen.queryByLabelText("Element text")).toBeNull();
  await act(async () => resolve(new Map([[assetId, imageSrc]])));
  await waitFor(() => expect(heading.textContent).toBe("New coffee"));
  expect(frame.getAttribute("srcdoc")).toBe(src); expect(frame.contentDocument.querySelector("h1")).toBe(heading);
  expect(frame.contentDocument.querySelector("img")).toBe(image); expect(image.getAttribute("src")).toBe(imageSrc);
  expect(heading.style.outline).toBe("4px solid red");
  fireEvent.click(heading); expect(screen.getByLabelText("Element text").value).toBe("New coffee");
  fireEvent.click(frame.contentDocument.querySelector("p")); expect(heading.style.outline).toBe("4px solid red");
});
it("keeps the previous document read-only after a replacement parse fails and recovers on retry", async () => {
  const content = site(), onDraft = vi.fn(), props = { zh: false, onDraft };
  const view = render(<WebVisualEditor {...props} content={content} />);
  const frame = await frameReady(); fireEvent.click(frame.contentDocument.querySelector("h1"));
  mocks.source.mockRejectedValueOnce(new Error("WEB_SOURCE_WORKER_UNAVAILABLE"));
  const next = site(); next.files[0].content = "<h1>Replacement</h1>";
  view.rerender(<WebVisualEditor {...props} content={next} />);
  await screen.findByRole("alert"); expect(screen.getByTitle("Visual website editor")).toBe(frame);
  expect(frame.style.pointerEvents).toBe("none");
  fireEvent.click(frame.contentDocument.querySelector("h1")); expect(screen.queryByLabelText("Element text")).toBeNull(); expect(onDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(frame.contentDocument.querySelector("h1").textContent).toBe("Replacement"));
  expect(frame.style.pointerEvents).toBe("auto");
  fireEvent.click(frame.contentDocument.querySelector("h1")); expect(screen.getByLabelText("Element text").value).toBe("Replacement");
});
