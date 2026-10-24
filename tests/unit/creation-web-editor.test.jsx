// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WebArtifactEditor from "../../src/components/creation/WebArtifactEditor";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { prepareWebRename } from "../../src/lib/creation/client/web-rename.js";
import { prepareWebImageInsertion } from "../../src/lib/creation/client/web-image-insert.js";
vi.mock("../../src/lib/creation/client/web-source-worker", () => ({ runWebSourceTask: async (type, payload) => type === "rename" ? prepareWebRename(payload.content, payload.request) : prepareWebImageInsertion(payload.content, payload.target, payload.page) }));

const mocks = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn(), write: vi.fn(), readText: vi.fn(), writeText: vi.fn(), preview: vi.fn(), images: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => "web-source-key-123456" }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/components/creation/DraftSessionGate", () => ({ default: ({ children }) => children("web-session-123456", () => {}) }));
vi.mock("../../src/components/ui/Modal", () => ({ default: ({ children, label }) => <div role="dialog" aria-label={label}>{children}</div> }));
vi.mock("../../src/components/studio/AssetLibrary", () => ({ default: ({ onSelect }) => <button onClick={() => onSelect(mocks.images())}>Choose library images</button> }));
vi.mock("../../src/lib/creation/client/web-preview-assets", () => ({ loadWebPreviewAssets: async () => new Map() }));
vi.mock("../../src/lib/creation/client/drafts", () => ({ readArtifactDraft: (...args) => mocks.read(...args), writeArtifactDraft: (...args) => mocks.write(...args), readArtifactTextDraft: (...args) => mocks.readText(...args), writeArtifactTextDraft: (...args) => mocks.writeText(...args) }));
vi.mock("../../src/components/creation/WebPreview", () => ({ default: ({ content }) => { mocks.preview(content); return <div>Website preview</div>; } }));
vi.mock("../../src/components/creation/WebVisualEditor", () => ({ default: ({ content, pageId, onDraft, onApply }) => {
  const file = content.files.find(file => file.id === pageId) || content.files[0];
  const draft = composing => onDraft({ kind: "web-source", fileId: file.id, path: file.path, fileKind: file.kind, original: file.content, text: "<p>Visual edit</p>", composing });
  return <div><span>Visual file: {file.path}</span><button onClick={() => draft(false)}>Draft visual</button><button onClick={() => draft(true)}>Compose visual</button><button onClick={onApply}>Apply visual</button></div>;
} }));
const site = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [
  { id: "html", path: "index.html", kind: "html", content: "<h1>Coffee</h1>" }, { id: "css", path: "styles.css", kind: "css", content: "h1{color:red}" },
] });
const sourceDraft = () => ({ kind: "web-source", fileId: "html", path: "index.html", fileKind: "html", original: "<h1>Coffee</h1>", text: "<h1>Recovered</h1>", composing: false });
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.read.mockResolvedValue(null); mocks.readText.mockResolvedValue(null); mocks.write.mockResolvedValue(undefined);
  mocks.images.mockReturnValue([{ assetId: "library-image-12345", name: "Coffee", asset: { contentType: "image/webp" } }]);
  mocks.writeText.mockImplementation(async (_u, _a, _value, prepare) => { await prepare?.(); });
  mocks.api.mockImplementation(async (_url, options) => options?.method === "PATCH" ? { artifactId: "a", revision: 2 } : { revision: 1, content: site() });
});
afterEach(cleanup);
async function open(props = {}) {
  const editorRef = createRef(), onError = vi.fn(), onReference = vi.fn();
  render(<WebArtifactEditor artifactId="a" userId="u" zh={false} editorRef={editorRef} onError={onError} onReference={onReference} {...props} />);
  await screen.findByText("Website preview");
  await waitFor(() => expect(screen.getByText("Save").disabled).toBe(false));
  fireEvent.click(screen.getByText("Code"));
  return { editorRef, onError, onReference };
}
it("retries a failed publication status read before enabling publish", async () => {
  let attempts = 0;
  mocks.api.mockImplementation(async (url, options) => {
    if (url.endsWith("/publication")) {
      attempts++;
      if (attempts === 1) throw new Error("Network lost");
      return { status: "unpublished", currentRevision: null, revisions: [] };
    }
    return options?.method === "PATCH" ? { artifactId: "a", revision: 2 } : { revision: 1, content: site() };
  });
  render(<WebArtifactEditor artifactId="a" userId="u" zh={false} onError={vi.fn()} />);
  await screen.findByText("Could not load publication status");
  expect(screen.getByText("Publish").disabled).toBe(true);
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(screen.getByText("Publish").disabled).toBe(false));
  expect(attempts).toBe(2);
});
it("retains incomplete source without rebuilding or saving the site on each keystroke, then flushes through the web API", async () => {
  const { editorRef } = await open(), before = mocks.preview.mock.calls.length;
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: "<h1>New coffee</h1>" } });
  expect(mocks.preview).toHaveBeenCalledTimes(before);
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  await waitFor(() => expect(mocks.writeText).toHaveBeenCalled());
  expect(mocks.writeText.mock.calls.at(-1)[2].text).toBe("<h1>New coffee</h1>");
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.revision).toBe(2); expect(saved.content.files[0].content).toBe("<h1>New coffee</h1>");
  const call = mocks.api.mock.calls.find(([, options]) => options?.method);
  expect(call[0]).toBe("/api/creation/artifacts/a/web"); expect(call[1].method).toBe("PATCH");
  expect(call[1].body.operations).toEqual([{ op: "setFile", fileId: "html", path: "index.html", kind: "html", content: "<h1>New coffee</h1>" }]);
  const writeIndex = mocks.write.mock.invocationCallOrder[0], clearIndex = mocks.writeText.mock.invocationCallOrder[mocks.writeText.mock.calls.findIndex(call => call[2] === null)];
  expect(writeIndex).toBeLessThan(clearIndex);
});
it("blocks switching files on invalid source and keeps the source available for correction", async () => {
  const { onError } = await open();
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: '<iframe src="https://evil.test"></iframe>' } });
  fireEvent.click(screen.getByText("styles.css"));
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(screen.getByLabelText("File source").value).toContain("iframe");
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: "<h1>Corrected</h1>" } });
  fireEvent.click(screen.getByText("styles.css"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("h1{color:red}"));
});
it("does not commit active IME composition and can undo a completed source replacement", async () => {
  const { editorRef } = await open();
  fireEvent.compositionStart(screen.getByLabelText("File source"));
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: "<h1>咖啡</h1>" } });
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("TEXT_COMPOSITION_ACTIVE"); });
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  fireEvent.compositionEnd(screen.getByLabelText("File source"));
  fireEvent.click(screen.getByText("Apply changes"));
  await waitFor(() => expect(screen.getByLabelText("Undo").disabled).toBe(false));
  fireEvent.click(screen.getByLabelText("Undo"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("<h1>Coffee</h1>"));
});
it("recovers unfinished code for editing and refuses to overwrite an independently changed file", async () => {
  mocks.readText.mockResolvedValue(sourceDraft());
  const editorRef = createRef(), onError = vi.fn();
  const remote = site(); remote.files[0].content = "<h1>Cloud update</h1>";
  mocks.api.mockResolvedValue({ revision: 2, content: remote });
  render(<WebArtifactEditor artifactId="a" userId="u" zh={false} editorRef={editorRef} onError={onError} />);
  await screen.findByLabelText("Source to recover");
  await expect(editorRef.current.flush()).rejects.toThrow("TEXT_DRAFT_REVIEW_REQUIRED");
  await waitFor(() => expect(screen.getByText("Continue editing").disabled).toBe(false));
  fireEvent.click(screen.getByText("Continue editing"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("<h1>Recovered</h1>"));
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("WEB_SOURCE_CHANGED"); });
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  fireEvent.click(screen.getByText("Discard input"));
  expect(screen.getByLabelText("File source").value).toBe("<h1>Recovered</h1>");
  fireEvent.click(screen.getByText("Confirm discard"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("<h1>Cloud update</h1>"));
});
it("references the selected file only after applying its pending edits", async () => {
  const { onReference, editorRef } = await open();
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: "<h1>Selected</h1>" } });
  fireEvent.click(screen.getByText("Ask AI to edit"));
  await waitFor(() => expect(onReference).toHaveBeenCalledWith({ kind: "web", fileIds: ["html"], paths: ["index.html"], label: "index.html" }));
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files[0].content).toBe("<h1>Selected</h1>"); expect(saved.content.files[1].content).toBe("h1{color:red}");
});
it("retains the same save key and patch when a response is lost", async () => {
  const { editorRef } = await open();
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: "<h1>Unknown response</h1>" } });
  mocks.api.mockRejectedValueOnce(new Error("Network lost"));
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("Network lost"); });
  const first = mocks.api.mock.calls.find(([, options]) => options?.method === "PATCH")[1].body;
  await act(async () => { await editorRef.current.flush(); });
  const calls = mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH");
  expect(calls).toHaveLength(2); expect(calls[1][1].body).toEqual(first);
});
it("edits the preview page even when another source file was selected, then preserves draft and undo in code view", async () => {
  const content = site(); content.files.push({ id: "about", path: "about.html", kind: "html", content: "<p>About</p>" });
  mocks.api.mockImplementation(async (_url, options) => options?.method === "PATCH" ? { artifactId: "a", revision: 2 } : { revision: 1, content });
  const { editorRef } = await open();
  fireEvent.click(screen.getByText("styles.css")); await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("h1{color:red}"));
  fireEvent.click(screen.getByText("Preview")); await screen.findByText("Website preview");
  fireEvent.change(screen.getByLabelText("Preview page"), { target: { value: "about" } });
  await waitFor(() => expect(screen.getByLabelText("Preview page").value).toBe("about"));
  fireEvent.click(screen.getByText("Visual")); await screen.findByText("Visual file: about.html");
  fireEvent.click(screen.getByText("Draft visual")); fireEvent.click(screen.getByText("Code"));
  expect(screen.getByLabelText("File source").value).toBe("<p>Visual edit</p>");
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files.map(file => file.content)).toEqual(["<h1>Coffee</h1>", "h1{color:red}", "<p>Visual edit</p>"]);
  fireEvent.click(screen.getByText("Visual")); await screen.findByText("Visual file: about.html");
  await waitFor(() => expect(screen.getByLabelText("Undo").disabled).toBe(false)); fireEvent.click(screen.getByLabelText("Undo"));
  await waitFor(() => expect(screen.getByLabelText("Redo").disabled).toBe(false));
  fireEvent.click(screen.getByText("Code")); expect(screen.getByLabelText("File source").value).toBe("<p>About</p>");
});
it("commits before changing visual pages and keeps the original page when IME composition blocks the change", async () => {
  const content = site(); content.files.push({ id: "about", path: "about.html", kind: "html", content: "<p>About</p>" });
  mocks.api.mockImplementation(async (_url, options) => options?.method === "PATCH" ? { artifactId: "a", revision: 2 } : { revision: 1, content });
  const { onError, editorRef } = await open();
  fireEvent.click(screen.getByText("Visual")); await screen.findByText("Visual file: index.html");
  fireEvent.click(screen.getByText("Compose visual"));
  expect(screen.getByText("Code").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Preview page"), { target: { value: "about" } });
  await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "TEXT_COMPOSITION_ACTIVE" })));
  expect(screen.getByLabelText("Preview page").value).toBe("html");
  fireEvent.click(screen.getByText("Draft visual"));
  fireEvent.change(screen.getByLabelText("Preview page"), { target: { value: "about" } });
  await screen.findByText("Visual file: about.html");
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files[0].content).toBe("<p>Visual edit</p>"); expect(saved.content.files[2].content).toBe("<p>About</p>");
});
it("creates a page, switches the entry, and restores both changes through undo and redo", async () => {
  const { editorRef } = await open();
  fireEvent.click(screen.getByText("New file"));
  fireEvent.change(await screen.findByLabelText("File path"), { target: { value: "pages/contact.html" } });
  fireEvent.click(screen.getByText("Create file"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("File source").value).toContain("New page");
  fireEvent.click(screen.getByText("Set as entry"));
  await waitFor(() => expect(screen.getByText("Delete file").disabled).toBe(true));
  fireEvent.click(screen.getByLabelText("Undo"));
  await waitFor(() => expect(screen.getByText("Delete file").disabled).toBe(false));
  fireEvent.click(screen.getByLabelText("Undo"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("<h1>Coffee</h1>"));
  fireEvent.click(screen.getByLabelText("Redo"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toContain("New page"));
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.entryPath).toBe("index.html"); expect(saved.content.files.map(file => file.path)).toEqual(["index.html", "styles.css", "pages/contact.html"]);
});
it("duplicates applied draft content and detects collisions in the dialog without changing other files", async () => {
  const { editorRef } = await open();
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: "<h1>Latest draft</h1>" } });
  fireEvent.click(screen.getByText("Duplicate file"));
  fireEvent.change(await screen.findByLabelText("File path"), { target: { value: "INDEX.HTML" } });
  fireEvent.click(screen.getByText("Create file"));
  await screen.findByRole("alert"); expect(screen.getByLabelText("File path").value).toBe("INDEX.HTML");
  fireEvent.change(screen.getByLabelText("File path"), { target: { value: "copy.html" } }); fireEvent.click(screen.getByText("Create file"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("File source").value).toBe("<h1>Latest draft</h1>");
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files.map(file => file.content)).toEqual(["<h1>Latest draft</h1>", "h1{color:red}", "<h1>Latest draft</h1>"]);
});
it("requires delete confirmation, applies a pending source draft, and can restore the removed file in order", async () => {
  const { editorRef } = await open();
  fireEvent.click(screen.getByText("styles.css")); await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("h1{color:red}"));
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: "h1{color:blue}" } });
  fireEvent.click(screen.getByText("Delete file")); await screen.findByText("Confirm delete");
  expect(screen.getByLabelText("File source").value).toBe("h1{color:blue}");
  fireEvent.click(screen.getByText("Confirm delete"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(within(screen.getByRole("navigation", { name: "Website files" })).queryByText("styles.css")).toBeNull();
  fireEvent.click(screen.getByLabelText("Undo"));
  await within(screen.getByRole("navigation", { name: "Website files" })).findByText("styles.css");
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files.map(file => file.path)).toEqual(["index.html", "styles.css"]); expect(saved.content.files[1].content).toBe("h1{color:blue}");
});
it("does not offer to repeat creation after a local write failure and retries persistence of the applied file", async () => {
  const { editorRef, onError } = await open();
  mocks.write.mockRejectedValue(new Error("Quota"));
  fireEvent.click(screen.getByText("New file")); await screen.findByLabelText("File path");
  fireEvent.click(screen.getByText("Create file"));
  await screen.findByText("Retry draft write"); expect(screen.queryByRole("dialog")).toBeNull(); expect(onError).toHaveBeenCalled();
  mocks.write.mockResolvedValue(undefined); fireEvent.click(screen.getByText("Retry draft write"));
  await waitFor(() => expect(screen.queryByText("Retry draft write")).toBeNull());
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files).toHaveLength(3);
});
it("renames the entry and its static references in one saved operation after applying the current source draft", async () => {
  const { editorRef } = await open();
  fireEvent.change(screen.getByLabelText("File source"), { target: { value: '<link rel="stylesheet" href="styles.css"><h1>Latest</h1>' } });
  fireEvent.click(screen.getByText("Rename"));
  fireEvent.change(await screen.findByLabelText("File path"), { target: { value: "pages/home.html" } });
  fireEvent.click(screen.getByText("Confirm rename"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("File source").value).toBe('<link rel="stylesheet" href="../styles.css"><h1>Latest</h1>');
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.entryPath).toBe("pages/home.html");
  const operations = mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH").flatMap(([, options]) => options.body.operations);
  expect(operations.map(operation => operation.op)).toEqual(["setFile", "renameFile"]);
  expect(operations[1].updates).toHaveLength(1);
  fireEvent.click(screen.getByLabelText("Undo"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toBe('<link rel="stylesheet" href="styles.css"><h1>Latest</h1>'));
  expect(within(screen.getByRole("navigation", { name: "Website files" })).getByText("index.html")).toBeTruthy();
});
it("adds a library image, inserts it into a page, and saves the resource registration and local reference", async () => {
  const { editorRef } = await open();
  expect(screen.queryByText("Choose library images")).toBeNull();
  fireEvent.click(screen.getByText("Add images")); fireEvent.click(await screen.findByText("Choose library images"));
  await screen.findByText("Insert at end of page"); expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("Insert at end of page"));
  await waitFor(() => expect(screen.getByLabelText("File source").value).toContain('src="image-library-image-12345.webp"'));
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.assetIds).toEqual(["library-image-12345"]);
  expect(saved.content.files[2]).toEqual({ id: "image-library-image-12345", path: "image-library-image-12345.webp", kind: "asset", assetId: "library-image-12345" });
  expect(saved.content.files[0].content).toContain("<h1>Coffee</h1>"); expect(saved.content.files[1].content).toBe("h1{color:red}");
  fireEvent.click(screen.getByLabelText("Undo")); await waitFor(() => expect(screen.getByLabelText("File source").value).toBe("<h1>Coffee</h1>"));
});
it("replaces an image while retaining its path and restores the old asset on undo", async () => {
  const content = site(); content.assetIds = ["original-image-12345"];
  content.files.push({ id: "image", kind: "asset", path: "hero.webp", assetId: content.assetIds[0] });
  content.files[0].content += '<img src="hero.webp">';
  mocks.api.mockImplementation(async (_url, options) => options?.method === "PATCH" ? { artifactId: "a", revision: 2 } : { revision: 1, content });
  const { editorRef } = await open();
  fireEvent.click(screen.getByText("hero.webp")); await screen.findByText("Replace image");
  fireEvent.click(screen.getByText("Replace image")); fireEvent.click(await screen.findByText("Choose library images"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files[2]).toEqual({ ...content.files[2], assetId: "library-image-12345" });
  expect(saved.content.files[0]).toEqual(content.files[0]); expect(saved.content.assetIds).toEqual(["library-image-12345"]);
  fireEvent.click(screen.getByLabelText("Undo"));
  await waitFor(() => expect(screen.getByText("Save").disabled).toBe(false));
  await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.content.files[2]).toEqual(content.files[2]); expect(saved.content.assetIds).toEqual(content.assetIds);
});
