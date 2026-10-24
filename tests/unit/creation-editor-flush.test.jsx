// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ArtifactEditor from "../../src/components/creation/ArtifactEditor";
vi.mock("../../src/components/creation/DraftSessionGate", () => ({ default: ({ children }) => children("test-session-123456", () => {}) }));

const state = vi.hoisted(() => ({ editor: null, commit: vi.fn(), readText: vi.fn(), writeText: vi.fn(), stored: vi.fn(), pendingText: null, discard: vi.fn() }));
vi.mock("../../src/lib/creation/client/drafts", () => ({ readArtifactTextDraft: (...args) => state.readText(...args), writeArtifactTextDraft: (...args) => state.writeText(...args) }));
vi.mock("../../src/components/creation/useLayoutArtifact", () => ({ useLayoutArtifact: () => state.editor }));
vi.mock("../../src/components/creation/editors/layout/LayoutEditor", async () => {
  const { useImperativeHandle } = await import("react");
  return { default: function Editor({ controllerRef, onPendingChange }) {
    useImperativeHandle(controllerRef, () => ({ commitPending: state.commit, getPendingText: () => state.pendingText, discardPending: state.discard }), []);
    return <button onClick={() => onPendingChange(true)}>Start pending text</button>;
  } };
});
beforeEach(() => {
  state.commit.mockReset();
  state.discard.mockReset(); state.pendingText = null;
  state.readText.mockReset().mockResolvedValue(null); state.stored.mockReset();
  state.writeText.mockReset().mockImplementation(async (_u, _a, draft, prepare) => { await prepare(); state.stored(draft); });
  state.editor = { content: { title: "Poster" }, revision: 1, ready: true, status: "saved", undoCount: 0, redoCount: 0, getContent: vi.fn(),
    change: vi.fn(), undo: vi.fn(), redo: vi.fn(), persistLocal: vi.fn(async () => {}), flush: vi.fn(async () => ({ revision: 2, content: { title: "Latest" } })) };
});
const unfinished = { pageId: "page", nodeId: "title", original: "Original", text: "Recovered", composing: true };
function source(text = "Original") { return { title: "Poster", pages: [{ id: "page", title: "Poster", nodes: [{ id: "title", name: "Headline", type: "text", text }] }] }; }
it("reviews recovered composition text and persists the operation journal before clearing recovery", async () => {
  state.readText.mockResolvedValue(unfinished); state.editor.content = source(); state.editor.getContent.mockImplementation(() => state.editor.content);
  const order = [];
  state.editor.change.mockImplementation(operations => { order.push("change"); state.editor.content.pages[0].nodes[0].text = operations[0].text; return true; });
  state.editor.persistLocal.mockImplementation(async () => { order.push("persist operations"); });
  state.writeText.mockImplementation(async (_u, _a, draft, prepare) => { await prepare(); order.push(draft === null ? "clear text" : "text"); });
  const editorRef = createRef(); render(<ArtifactEditor artifactId="a" userId="u" editorRef={editorRef} zh={false} />);
  expect((await screen.findByLabelText("Text to recover")).value).toBe("Recovered");
  await expect(editorRef.current.flush()).rejects.toThrow("TEXT_DRAFT_REVIEW_REQUIRED");
  fireEvent.change(screen.getByLabelText("Text to recover"), { target: { value: "Reviewed 中文" } });
  fireEvent.click(screen.getByText("Restore to artwork"));
  await waitFor(() => expect(screen.queryByLabelText("Text to recover")).toBeNull());
  expect(order).toEqual(["change", "persist operations", "clear text"]);
  expect(state.editor.change).toHaveBeenCalledWith([{ op: "setText", pageId: "page", nodeId: "title", text: "Reviewed 中文" }]);
});
it("keeps recovered text visible when the original changes or local persistence fails", async () => {
  state.readText.mockResolvedValue(unfinished); state.editor.content = source("Cloud update"); state.editor.getContent.mockImplementation(() => state.editor.content);
  const onError = vi.fn(); render(<ArtifactEditor artifactId="a" userId="u" onError={onError} zh={false} />);
  await screen.findByLabelText("Text to recover");
  await act(async () => fireEvent.click(screen.getByText("Restore to artwork")));
  expect(onError.mock.calls.at(-1)[0].message).toBe("TEXT_EDIT_TARGET_CHANGED");
  expect(state.editor.change).not.toHaveBeenCalled(); expect(state.writeText).not.toHaveBeenCalled();
  state.editor.content = source(); state.editor.persistLocal.mockRejectedValue(new Error("Quota"));
  await act(async () => fireEvent.click(screen.getByText("Restore to artwork")));
  expect(onError.mock.calls.at(-1)[0].message).toBe("Quota"); expect(state.stored).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Text to recover").value).toBe("Recovered");
});
it("passes pending text into a conflict copy without trying to commit into a read-only original", async () => {
  state.editor.status = "conflict"; state.pendingText = { ...unfinished, composing: false };
  state.editor.saveConflictCopy = vi.fn(async () => ({ artifactId: "copy", revision: 1 }));
  state.commit.mockImplementation(() => { throw new Error("TEXT_EDIT_NOT_COMMITTED"); });
  const onArtifactCreated = vi.fn(); render(<ArtifactEditor artifactId="a" userId="u" onArtifactCreated={onArtifactCreated} zh={false} />);
  await screen.findByText("Start pending text");
  await act(async () => fireEvent.click(screen.getByText("Keep edits as a copy")));
  expect(state.commit).not.toHaveBeenCalled(); expect(state.editor.saveConflictCopy).toHaveBeenCalledWith("Poster (local copy)", { ...unfinished, composing: false });
  expect(state.discard).toHaveBeenCalledOnce(); expect(state.writeText).toHaveBeenLastCalledWith("u", "a", null, expect.any(Function), "test-session-123456");
  expect(onArtifactCreated).toHaveBeenCalledWith({ artifactId: "copy", revision: 1 });
});
afterEach(cleanup);

it("uses the pending-text barrier for external saves and the save button", async () => {
  const editorRef = createRef(), order = [];
  state.commit.mockImplementation(() => order.push("text"));
  state.editor.flush.mockImplementation(async () => { order.push("save"); return { revision: 2, content: { title: "Latest" } }; });
  render(<ArtifactEditor artifactId="a" userId="u" editorRef={editorRef} zh={false} />);
  await screen.findByText("Start pending text");
  let saved;
  await act(async () => { saved = await editorRef.current.flush(); });
  expect(order).toEqual(["text", "save"]);
  expect(saved.revision).toBe(2);
  await act(async () => fireEvent.click(screen.getByTitle("Save artwork")));
  expect(order).toEqual(["text", "save", "text", "save"]);
});

it("blocks dependent saves on pending-text failure and shows unsaved text instead of saved", async () => {
  const editorRef = createRef(), error = new Error("TEXT_COMPOSITION_ACTIVE"), onError = vi.fn();
  state.commit.mockImplementation(() => { throw error; });
  render(<ArtifactEditor artifactId="a" userId="u" editorRef={editorRef} onError={onError} zh={false} />);
  fireEvent.click(await screen.findByText("Start pending text"));
  expect(screen.getByText("Text not yet saved")).toBeTruthy();
  await expect(editorRef.current.flush()).rejects.toBe(error);
  await act(async () => fireEvent.click(screen.getByTitle("Save artwork")));
  expect(state.editor.flush).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(error);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
