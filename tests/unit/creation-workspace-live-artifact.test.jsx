// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CreationWorkspace from "../../src/components/creation/CreationWorkspace";
import { publishedArtifactRevisions } from "../../src/lib/creation/published-artifact-revisions";

const mocks = vi.hoisted(() => ({ api: vi.fn(), onRun: null, mounts: 0 }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => "live-artifact-key" }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/components/creation/useCreationRun", () => ({ useCreationRun: (_id, onChange) => { mocks.onRun = onChange; return { run: null, error: null }; } }));
vi.mock("../../src/components/creation/ReferenceAssets", () => ({ default: () => null, referenceAssetIds: value => value || [], MessageReferenceAssets: () => null }));
vi.mock("../../src/components/creation/ProjectFiles", () => ({ default: ({ onSelect }) => <button onClick={() => onSelect("b", false, "slides")}>Open another file</button> }));
vi.mock("../../src/components/creation/CreationArtifactEditor", async () => {
  const { useImperativeHandle, useState } = await import("react");
  return { warmCreationEditor: vi.fn(), default: function Editor({ artifactId, remoteRevision, editorRef }) {
    const [mount] = useState(() => ++mocks.mounts);
    useImperativeHandle(editorRef, () => ({ flush: async () => ({ revision: 17 }) }), []);
    return <div data-testid="editor" data-mount={mount} data-artifact={artifactId} data-revision={remoteRevision || 17} />;
  } };
});
const step = (id, artifactId, revision) => ({ id, status: "succeeded", result: { artifactId, revision } });
const snapshot = steps => ({ id: "run", status: "running", eventSequence: 20, steps });
beforeEach(() => {
  sessionStorage.clear(); mocks.mounts = 0; mocks.onRun = null;
  mocks.api.mockReset().mockImplementation(async url => {
    if (url === "/api/creation/capabilities") return { slides: true, languageUnitCost: 2 };
    if (url === "/api/creation/projects/p") return { id: "p", kind: "slides", name: "Deck", sessions: [{ id: "s" }], artifacts: [{ id: "a", kind: "slides" }, { id: "b", kind: "slides" }] };
    return { items: [] };
  });
});
afterEach(cleanup);
it("sends the highest published revision to the mounted editor while generation is still running", async () => {
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  const editor = await screen.findByTestId("editor");
  await act(async () => mocks.onRun(snapshot([step("earlier-page", "a", 20), step("later-page", "a", 18)])));
  expect(editor.dataset.revision).toBe("20");
  expect(screen.getByTestId("editor")).toBe(editor);
  expect(mocks.mounts).toBe(1);
  expect(screen.queryByText("Open latest artwork")).toBeNull();
  const reads = mocks.api.mock.calls.length;
  await act(async () => mocks.onRun(snapshot([step("older-event", "a", 19)])));
  expect(editor.dataset.revision).toBe("20");
  expect(mocks.api).toHaveBeenCalledTimes(reads);
});
it("preserves the selected file and retains each artifact's revision separately", async () => {
  render(<CreationWorkspace userId="u" projectId="p" zh={false} />);
  await screen.findByTestId("editor");
  await act(async () => fireEvent.click(screen.getByText("Open another file")));
  const editor = screen.getByTestId("editor");
  await act(async () => mocks.onRun(snapshot([step("a", "a", 20), step("b", "b", 3)])));
  expect(screen.getByTestId("editor")).toBe(editor);
  expect(editor.dataset.artifact).toBe("b");
  expect(editor.dataset.revision).toBe("3");
});
it("ignores unfinished results and never compares revisions between artifacts", () => {
  expect(publishedArtifactRevisions([step("1", "a", 20), step("2", "a", 18), step("3", "b", 2),
    { ...step("4", "a", 22), status: "running" }, step("bad", "a", null)])).toEqual({ a: 20, b: 2 });
});
