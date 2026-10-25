// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLayoutArtifact } from "../../src/components/creation/useLayoutArtifact";

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), api: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => "stable-copy-key-123" }));
vi.mock("../../src/lib/creation/client/drafts", () => ({ readArtifactDraft: (...args) => mocks.read(...args), writeArtifactDraft: (...args) => mocks.write(...args) }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
const content = text => ({ title: "Poster", kind: "poster", pages: [{ id: "p", nodes: [{ id: "n", type: "text", text, locked: false }] }] });
const pending = { pageId: "p", nodeId: "n", original: "Local", text: "Unfinished text", composing: false };
beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue({ baseRevision: 1, content: content("Local"), operations: [{ op: "setText", pageId: "p", nodeId: "n", text: "Local" }], inflight: null });
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.api.mockReset().mockImplementation(async (_url, options) => options?.method === "POST" ? { artifactId: "copy", revision: 1 } : { revision: 2, content: content("Cloud") });
});
afterEach(cleanup);
it("applies a published revision to a clean editor without reloading or posting operations", async () => {
  mocks.read.mockResolvedValue(null);
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const newer = { ...content("Cloud"), pages: [...content("Cloud").pages, { id: "p2", nodes: [] }] };
  mocks.api.mockResolvedValueOnce({ revision: 5, content: newer });
  await act(async () => { expect(await result.current.refreshRemote(5)).toBe(true); });
  expect(result.current.content).toEqual(newer);
  expect(result.current.revision).toBe(5);
  expect(result.current.status).toBe("saved");
  expect(result.current.ready).toBe(true);
  const reads = mocks.api.mock.calls.length;
  await act(async () => { expect(await result.current.refreshRemote(3)).toBe(true); });
  expect(mocks.api).toHaveBeenCalledTimes(reads);
  expect(mocks.api.mock.calls.some(([, options]) => options?.method)).toBe(false);
});
it("defers a remote revision while text interaction or unsaved operations exist", async () => {
  mocks.read.mockResolvedValue(null);
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(await result.current.refreshRemote(3, { canApply: () => false })).toBe(false);
  act(() => result.current.change([{ op: "setText", pageId: "p", nodeId: "n", text: "Keep typing" }]));
  expect(await result.current.refreshRemote(3)).toBe(false);
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(result.current.content.pages[0].nodes[0].text).toBe("Keep typing");
});
it("does not overwrite edits started while a background read is in flight", async () => {
  mocks.read.mockResolvedValue(null);
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let resolve;
  mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const update = result.current.refreshRemote(3);
  act(() => result.current.change([{ op: "setText", pageId: "p", nodeId: "n", text: "Local edit" }]));
  await act(async () => { resolve({ revision: 3, content: content("Generated") }); expect(await update).toBe(false); });
  expect(result.current.content.pages[0].nodes[0].text).toBe("Local edit");
  expect(result.current.revision).toBe(2);
});
it("rechecks transient editor interaction after the background read", async () => {
  mocks.read.mockResolvedValue(null);
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let resolve, idle = true;
  mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const update = result.current.refreshRemote(3, { canApply: () => idle });
  idle = false;
  await act(async () => { resolve({ revision: 3, content: content("Generated") }); expect(await update).toBe(false); });
  expect(result.current.revision).toBe(2);
});
it("ignores an older concurrent response and a response for a closed editor", async () => {
  mocks.read.mockResolvedValue(null);
  const { result, unmount } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let resolve;
  mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const slow = result.current.refreshRemote(3);
  mocks.api.mockResolvedValueOnce({ revision: 4, content: content("Newest") });
  await act(async () => { await result.current.refreshRemote(4); });
  await act(async () => { resolve({ revision: 3, content: content("Older") }); expect(await slow).toBe(false); });
  expect(result.current.revision).toBe(4);
  expect(result.current.content.pages[0].nodes[0].text).toBe("Newest");
  mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const closed = result.current.refreshRemote(5);
  unmount();
  resolve({ revision: 5, content: content("After close") });
  expect(await closed).toBe(false);
});
it("stores unfinished text in the conflict copy before sending it and preserves the newer original", async () => {
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.status).toBe("conflict"));
  await act(async () => { await result.current.saveConflictCopy("Copy", pending); });
  const submission = mocks.api.mock.calls.find(([, options]) => options?.method === "POST");
  expect(submission[0]).toBe("/api/creation/artifacts/a/copy");
  expect(submission[1].body.content.pages[0].nodes[0].text).toBe("Unfinished text");
  expect(mocks.write.mock.calls[0][2].content.pages[0].nodes[0].text).toBe("Unfinished text");
  expect(result.current.getContent().pages[0].nodes[0].text).toBe("Cloud"); expect(result.current.status).toBe("saved");
});
it("keeps a failed copy frozen and reuses its exact content and key on retry", async () => {
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.status).toBe("conflict"));
  mocks.api.mockRejectedValueOnce(new Error("Unknown response"));
  await act(async () => { await expect(result.current.saveConflictCopy("Copy", pending)).rejects.toThrow("Unknown response"); });
  expect(result.current.copyPending).toBe(true); expect(result.current.status).toBe("conflict");
  await act(async () => { await result.current.saveConflictCopy("Different title", { ...pending, text: "Different text" }); });
  const requests = mocks.api.mock.calls.filter(([, options]) => options?.method === "POST").map(([, options]) => options.body);
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(requests[1].content.title).toBe("Copy");
});
it("does not submit a copy when text composition is active, its target changed, or persistence fails", async () => {
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.status).toBe("conflict"));
  await expect(result.current.saveConflictCopy("Copy", { ...pending, composing: true })).rejects.toThrow("TEXT_COMPOSITION_ACTIVE");
  await expect(result.current.saveConflictCopy("Copy", { ...pending, original: "Wrong" })).rejects.toThrow("TEXT_EDIT_TARGET_CHANGED");
  mocks.write.mockRejectedValueOnce(new Error("Quota"));
  await act(async () => { await expect(result.current.saveConflictCopy("Copy", pending)).rejects.toThrow("Quota"); });
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  expect(result.current.getContent().pages[0].nodes[0].text).toBe("Unfinished text"); expect(result.current.status).toBe("conflict");
});
it("opens the cloud version when IndexedDB draft reads are unavailable", async () => {
  mocks.read.mockRejectedValueOnce(Object.assign(new Error("Blocked"), { code: "LOCAL_DRAFT_UNAVAILABLE" }));
  const { result } = renderHook(() => useLayoutArtifact("u", "a", "browser-session-a-123"));
  await waitFor(() => expect(result.current.status).toBe("saved"));
  expect(result.current.ready).toBe(true); expect(result.current.content.pages[0].nodes[0].text).toBe("Cloud");
});

it("bounds a navigation save and replays its exact journal when the request times out", async () => {
  mocks.read.mockResolvedValue(null);
  let timeout = true;
  mocks.api.mockImplementation(async (_url, options) => {
    if (!options?.method) return { revision: 2, content: content("Cloud") };
    if (timeout) { timeout = false; throw Object.assign(new Error("Request timed out"), { code: "REQUEST_TIMEOUT" }); }
    return { revision: 3 };
  });
  const { result } = renderHook(() => useLayoutArtifact("u", "a"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const page = result.current.content.pages[0], node = page.nodes[0];
  act(() => result.current.change([{ op: "setText", pageId: page.id, nodeId: node.id, text: "Saved after retry" }]));
  await act(async () => { await expect(result.current.flush()).rejects.toThrow("Request timed out"); });
  expect(result.current.unsaved).toBe(true);
  const first = mocks.api.mock.calls.find(([, options]) => options?.method)[1];
  expect(first.timeoutMs).toBe(30000);
  expect(mocks.write.mock.calls.at(-1)[2].inflight).toEqual(first.body);
  await act(async () => { await result.current.flush(); });
  const saves = mocks.api.mock.calls.filter(([, options]) => options?.method);
  expect(saves).toHaveLength(2); expect(saves[1][1].body).toEqual(first.body);
  expect(result.current.unsaved).toBe(false); expect(result.current.revision).toBe(3);
});
