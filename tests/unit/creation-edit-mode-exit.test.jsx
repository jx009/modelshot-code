// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ArtifactEditor from "../../src/components/creation/ArtifactEditor";

const mocks = vi.hoisted(() => ({ save: vi.fn(), persist: vi.fn(), commit: vi.fn(), review: vi.fn(), state: null, text: null }));
vi.mock("../../src/components/creation/useLayoutArtifact", () => ({ useLayoutArtifact: () => mocks.state }));
vi.mock("../../src/components/creation/usePendingTextDraft", () => ({ usePendingTextDraft: () => mocks.text }));
vi.mock("../../src/components/creation/useLiveArtifactRevision", () => ({ useLiveArtifactRevision: () => {} }));
vi.mock("../../src/components/creation/DraftSessionGate", () => ({ default: ({ children }) => children("draft", () => {}) }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/components/creation/editors/html/HtmlSlideViewer", async () => {
  const { useImperativeHandle } = await import("react");
  return { default: function Viewer({ controllerRef, editing, thumbnails }) {
    useImperativeHandle(controllerRef, () => ({ commitPending: mocks.commit, canRefreshRemote: () => !editing }), [editing]);
    return <div>{editing ? "editing document" : "browsing document"}{thumbnails && <span>thumbnail rail</span>}</div>;
  } };
});
beforeEach(() => {
  mocks.save.mockReset(); mocks.persist.mockReset().mockResolvedValue(); mocks.commit.mockReset(); mocks.review.mockReset();
  const content = { schemaVersion: 3, kind: "slides", title: "Deck", pages: [{ id: "p", title: "Cover", html: "<p>Cover</p>" }] };
  mocks.state = { content, ready: true, status: "saved", revision: 1, flush: mocks.save, persistLocal: mocks.persist, getContent: () => content, change: vi.fn() };
  mocks.text = { ready: true, recovery: null, flush: vi.fn().mockResolvedValue(), snapshot: () => null, reviewPending: mocks.review };
});
afterEach(cleanup);
it("exits immediately while the cloud save is still pending", async () => {
  let resolve;
  mocks.save.mockImplementation(() => new Promise(done => { resolve = done; }));
  const onEditing = vi.fn();
  render(<ArtifactEditor artifactId="a" userId="u" zh onEditingChange={onEditing} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑", exact: true }));
  expect(screen.getByText("thumbnail rail")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "退出编辑" }));
  expect(screen.getByText("browsing document")).toBeTruthy();
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(onEditing).toHaveBeenLastCalledWith("a", false);
  await act(async () => resolve({ revision: 2 }));
});
it("keeps the browse mode and an explicit retry when saving fails", async () => {
  mocks.save.mockRejectedValue(new Error("NETWORK_ERROR"));
  render(<ArtifactEditor artifactId="a" userId="u" zh onError={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑", exact: true }));
  await act(async () => fireEvent.click(screen.getByText("退出编辑")));
  expect(screen.getByText("browsing document")).toBeTruthy();
  expect(screen.getByText("重试保存")).toBeTruthy();
  expect(mocks.persist).toHaveBeenCalled();
});
it("retains an uncommittable text draft for recovery instead of trapping edit mode", async () => {
  mocks.commit.mockImplementation(() => { throw new Error("HTML_SOURCE_CHANGED"); });
  mocks.save.mockResolvedValue({ revision: 1 });
  render(<ArtifactEditor artifactId="a" userId="u" zh onError={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑", exact: true }));
  await act(async () => fireEvent.click(screen.getByText("退出编辑")));
  expect(mocks.review).toHaveBeenCalledOnce();
  expect(screen.getByText("browsing document")).toBeTruthy();
});
