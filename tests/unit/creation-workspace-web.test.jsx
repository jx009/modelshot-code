// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CreationWorkspace from "../../src/components/creation/CreationWorkspace";
import { deferNavigation } from "../../src/lib/navigation-guard.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
const mocks = vi.hoisted(() => ({ api: vi.fn(), flush: vi.fn(), kind: "web", artifactKind: null, target: { kind: "web", fileIds: ["html"], paths: ["index.html"], label: "index.html" } }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => "workspace-submit-12345" }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/components/creation/useCreationRun", () => ({ useCreationRun: () => ({ run: null, error: null }) }));
vi.mock("../../src/components/creation/ReferenceAssets", () => ({ default: () => null, referenceAssetIds: value => value || [], MessageReferenceAssets: () => null }));
vi.mock("../../src/components/creation/ProjectFiles", () => ({ default: () => null }));
vi.mock("../../src/components/creation/CreationArtifactEditor", async () => {
  const { useImperativeHandle } = await import("react");
  return { default: function Editor({ kind, editorRef, onReference }) {
    useImperativeHandle(editorRef, () => ({ flush: mocks.flush }), []);
    return <button onClick={() => onReference(mocks.target)}>Select {kind} file</button>;
  } };
});
const content = { kind: "web", files: [{ id: "html", path: "index.html", kind: "html", content: "<h1>Saved selection</h1>" }] };
beforeEach(() => {
  sessionStorage.clear(); mocks.kind = "web"; mocks.artifactKind = null; mocks.target = { kind: "web", fileIds: ["html"], paths: ["index.html"], label: "index.html" };
  mocks.flush.mockReset().mockResolvedValue({ revision: 3, content });
  mocks.api.mockReset().mockImplementation(async (url, options) => {
    if (options?.method === "POST") return { id: "run", kind: mocks.kind };
    if (url === "/api/creation/capabilities") return { web: true, poster: true, slides: true, document: true, sheet: true, languageUnitCost: 2 };
    if (url === "/api/creation/projects/p") return { id: "p", kind: mocks.kind, name: "Test", sessions: [{ id: "s" }], artifacts: [{ id: "a", kind: mocks.artifactKind || mocks.kind }] };
    return { items: [] };
  });
});
afterEach(cleanup);
it("opens an artifact with its own format even when it differs from the project's default kind", async () => {
  mocks.kind = "web";
  mocks.artifactKind = "poster";
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  expect(await screen.findByText("Select poster file")).toBeTruthy();
});
it("sends native document text spans and rejects a reference from before the latest save", async () => {
  mocks.kind = "document";
  const native = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Section", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original", marks: {} }] }] }] }, "unit");
  mocks.target = { format: "univer-document-1", unitId: "unit", segmentId: "", spans: [{ start: 0, end: 8, expectedText: "Original" }], baseRevision: 2, label: "Selected text" };
  mocks.flush.mockResolvedValue({ revision: 3, content: native });
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  fireEvent.click(await screen.findByText("Select document file"));
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Polish this paragraph" } });
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  expect((await screen.findByRole("alert")).textContent).toContain("selection changed");
  expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  mocks.target = { ...mocks.target, baseRevision: 3 };
  fireEvent.click(screen.getByText("Select document file"));
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const target = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body.target;
  expect(target).toEqual({ artifactId: "a", format: "univer-document-1", unitId: "unit", segmentId: "", spans: mocks.target.spans, baseRevision: 3 });
  expect(target).not.toHaveProperty("blockIds");
});
it("submits native cell scope without the legacy projection and blocks coordinates from an older revision", async () => {
  mocks.kind = "sheet";
  const native = toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Costs", cells: [] }] }, "unit");
  mocks.target = { format: "univer-sheet-1", unitId: "unit", sheetId: "sheet0", cells: [{ row: 0, column: 0 }], baseRevision: 3, label: "A1" };
  mocks.flush.mockResolvedValue({ revision: 4, content: native });
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  fireEvent.click(await screen.findByText("Select sheet file"));
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Set the amount" } });
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  expect((await screen.findByRole("alert")).textContent).toContain("selection changed");
  expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  mocks.target = { ...mocks.target, baseRevision: 4 };
  fireEvent.click(screen.getByText("Select sheet file"));
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const sent = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(sent.target).toEqual({ artifactId: "a", format: "univer-sheet-1", unitId: "unit", sheetId: "sheet0", cells: [{ row: 0, column: 0 }], baseRevision: 4 });
  expect(sent.target).not.toHaveProperty("addresses");
});

it("replays a journaled native submission with the same revision/key even if the editor now contains a newer revision", async () => {
  mocks.kind = "sheet";
  const target = { artifactId: "a", format: "univer-sheet-1", unitId: "unit", sheetId: "sheet0", cells: [{ row: 0, column: 0 }], baseRevision: 3 };
  const body = { kind: "sheet", prompt: "Set amount", locale: "en", target, maxCredits: 2 };
  sessionStorage.setItem("creation-submit:u:p:default", JSON.stringify({ key: "same-native-submit-key", sessionId: "s", body }));
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select sheet file");
  await act(async () => fireEvent.click(screen.getByLabelText("Recover submission")));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const request = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1];
  expect(request.body).toEqual(body); expect(request.key).toBe("same-native-submit-key");
  expect(mocks.flush).not.toHaveBeenCalled();
});
it("persists the composer and awaits the editor before navigating, while preventing concurrent actions", async () => {
  let saved; mocks.flush.mockImplementation(() => new Promise(resolve => { saved = resolve; }));
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select web file");
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Keep this request" } });
  const go = vi.fn();
  act(() => { expect(deferNavigation(go)).toBe(true); });
  expect(JSON.parse(sessionStorage.getItem("creation-composer:u:p:default")).prompt).toBe("Keep this request");
  expect(document.querySelector(".cw-workspace").inert).toBe(true);
  expect(screen.getByText("Saving artwork and drafts before leaving…")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Start creation"));
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  expect(go).not.toHaveBeenCalled();
  await act(async () => saved({ revision: 3, content }));
  expect(go).toHaveBeenCalledOnce(); expect(document.querySelector(".cw-workspace").inert).toBe(false);
});

it("keeps the workspace editable when cloud saving rejects and permits a later navigation retry", async () => {
  mocks.flush.mockRejectedValueOnce(new Error("ARTIFACT_VERSION_CONFLICT")).mockResolvedValue({ revision: 3, content });
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select web file");
  const go = vi.fn();
  await act(async () => { deferNavigation(go); });
  expect(go).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toBeTruthy();
  expect(document.querySelector(".cw-workspace").inert).toBe(false);
  await act(async () => { deferNavigation(go); }); expect(go).toHaveBeenCalledOnce();
});

it("blocks navigation on composer storage failure without trying to save or dropping the input", async () => {
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select web file"); fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Unsaved brief" } });
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
  const go = vi.fn();
  try {
    await act(async () => { deferNavigation(go); });
    expect(go).not.toHaveBeenCalled(); expect(mocks.flush).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Creation request").value).toBe("Unsaved brief");
    expect(screen.getByRole("alert").textContent).toContain("conversation draft could not be saved");
  } finally { storage.mockRestore(); }
});

it("does not navigate when the workspace was unmounted before its save returned", async () => {
  let saved; mocks.flush.mockImplementation(() => new Promise(resolve => { saved = resolve; }));
  const view = render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select web file"); const go = vi.fn();
  act(() => { deferNavigation(go); }); view.unmount();
  await act(async () => saved({ revision: 3, content })); expect(go).not.toHaveBeenCalled();
});
it("restores reference IDs from the local draft and includes them in the submitted task", async () => {
  sessionStorage.setItem("creation-composer:u:p:default", JSON.stringify({ prompt: "Use my brief", referenceIds: ["brief"] }));
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select web file");
  expect(screen.getByLabelText("Creation request").value).toBe("Use my brief");
  fireEvent.click(screen.getByLabelText("Start creation"));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  expect(mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body.referenceIds).toEqual(["brief"]);
});
it("shows website page count without image dimensions and submits the web-specific generation contract", async () => {
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select web file");
  expect(screen.queryByLabelText("Page dimensions")).toBeNull();
  expect(screen.queryByLabelText("Page count")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Materials and options" }));
  expect(screen.getByLabelText("Page count").value).toBe("1");
  fireEvent.change(screen.getByLabelText("Page count"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Create a coffee website" } });
  fireEvent.click(screen.getByLabelText("Start creation"));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const request = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(request).toEqual({ kind: "web", prompt: "Create a coffee website", locale: "en", pageCount: 3, maxCredits: 2, assetIds: [], referenceIds: [] });
});
it("flushes selected website source and sends exact file identities and the saved revision", async () => {
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  fireEvent.click(await screen.findByText("Select web file"));
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Change title" } });
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  await waitFor(() => expect(mocks.flush).toHaveBeenCalledOnce());
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const request = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(request.target).toEqual({ artifactId: "a", baseRevision: 3, fileIds: ["html"], paths: ["index.html"] });
  expect(request).not.toHaveProperty("width"); expect(request.target).not.toHaveProperty("pageId");
});
it("rejects stale website file selection without creating a paid task", async () => {
  mocks.target = { ...mocks.target, paths: ["missing.html"] };
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  fireEvent.click(await screen.findByText("Select web file"));
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Change title" } });
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  await screen.findByRole("alert");
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
});
it("keeps poster dimensions and layout selection on their existing request path", async () => {
  mocks.kind = "poster"; mocks.target = { pageId: "p1", nodeId: "n1", label: "Title" };
  mocks.flush.mockResolvedValue({ revision: 4, content: { pages: [{ id: "p1", nodes: [{ id: "n1", locked: false }] }] } });
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select poster file");
  expect(screen.queryByLabelText("Page dimensions")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Materials and options" }));
  expect(screen.getByLabelText("Page dimensions")).toBeTruthy();
  fireEvent.click(screen.getByText("Select poster file"));
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Change headline" } });
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  const request = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(request).toMatchObject({ kind: "poster", width: 1080, height: 1440, target: { artifactId: "a", baseRevision: 4, pageId: "p1", nodeIds: ["n1"] } });
});
it("submits document section parameters and a validated block selection", async () => {
  mocks.kind = "document";
  mocks.target = { kind: "document", sectionId: "intro", blockIds: ["summary"], label: "Summary" };
  mocks.flush.mockResolvedValue({ revision: 5, content: { kind: "document", sections: [{ id: "intro", blocks: [{ id: "summary", locked: false }] }] } });
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select document file");
  expect(screen.queryByLabelText("Page dimensions")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Materials and options" }));
  fireEvent.change(screen.getByLabelText("Section count"), { target: { value: "8" } });
  fireEvent.click(screen.getByText("Select document file"));
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Revise summary" } });
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const request = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(request).toEqual({ kind: "document", prompt: "Revise summary", locale: "en", sectionCount: 8, audience: "", maxCredits: 2, assetIds: [], referenceIds: [], target: { artifactId: "a", baseRevision: 5, sectionId: "intro", blockIds: ["summary"] } });
});
it("submits sheet generation parameters and a validated cell selection", async () => {
  mocks.kind = "sheet";
  mocks.target = { kind: "sheet", sheetId: "sales", addresses: ["B2"], label: "Sales!B2" };
  mocks.flush.mockResolvedValue({ revision: 6, content: { kind: "sheet", sheets: [{ id: "sales", cells: [] }] } });
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select sheet file");
  expect(screen.queryByLabelText("Page dimensions")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Materials and options" }));
  fireEvent.change(screen.getByLabelText("Sheet count"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Target rows"), { target: { value: "40" } });
  fireEvent.click(screen.getByText("Select sheet file"));
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Fill the sales forecast" } });
  await act(async () => fireEvent.click(screen.getByLabelText("Start creation")));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const request = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(request).toEqual({ kind: "sheet", prompt: "Fill the sales forecast", locale: "en", sheetCount: 3, targetRows: 40, maxCredits: 2, assetIds: [], referenceIds: [], target: { artifactId: "a", baseRevision: 6, sheetId: "sales", addresses: ["B2"] } });
});

const messagePage = (first, last) => ({ items: Array.from({ length: last - first + 1 }, (_, offset) => ({ id: `m${first + offset}`, sequence: first + offset, role: "user", text: `History message ${first + offset}`, references: [] })), nextCursor: first > 1 ? first : null });
it("sends on Enter while preserving Shift+Enter, composing input and held keys", async () => {
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("Select web file");
  const input = screen.getByLabelText("Creation request");
  fireEvent.change(input, { target: { value: "制作咖啡店网页" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(input, { key: "Enter", repeat: true });
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1));
  expect(mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body.prompt).toBe("制作咖啡店网页");
});
it("keeps older messages during project refresh and ignores an old pagination response after returning to latest", async () => {
  const base = mocks.api.getMockImplementation();
  let latest = messagePage(151, 200), finishOlder;
  mocks.api.mockImplementation((url, options) => {
    if (url === "/api/creation/sessions/s/messages") return Promise.resolve(latest);
    if (url.endsWith("?before=151")) return Promise.resolve(messagePage(101, 150));
    if (url.endsWith("?before=101")) return new Promise(resolve => { finishOlder = resolve; });
    return base(url, options);
  });
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByText("History message 151");
  fireEvent.click(screen.getByText("Earlier messages"));
  await screen.findByText("History message 101");
  latest = messagePage(152, 201);
  fireEvent.click(screen.getByLabelText("Refresh project"));
  await screen.findByText("History message 201");
  expect(screen.getByText("History message 101")).toBeTruthy();
  fireEvent.click(screen.getByText("Earlier messages"));
  await waitFor(() => expect(finishOlder).toBeDefined());
  fireEvent.click(screen.getByText("Return to latest messages"));
  await waitFor(() => expect(screen.queryByText("History message 101")).toBeNull());
  await act(async () => finishOlder(messagePage(51, 100)));
  expect(screen.queryByText("History message 51")).toBeNull();
  expect(screen.getByText("History message 201")).toBeTruthy();
});
