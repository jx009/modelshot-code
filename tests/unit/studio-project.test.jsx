// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioProject } from "../../src/components/studio/useStudioProject";
import { promptTitle } from "../../src/lib/studio/project-title.js";
import { taskSummary } from "../../src/lib/studio/task-presentation.js";

const mocks = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api, requestKey: () => crypto.randomUUID() }));
vi.mock("@/lib/studio/project-storage", () => ({
  activeProject: () => null,
  rememberProject: vi.fn(),
  readProjectDraft: mocks.read,
  writeProjectDraft: mocks.write,
}));
beforeEach(() => { mocks.api.mockReset(); mocks.read.mockReset().mockResolvedValue(null); mocks.write.mockReset().mockResolvedValue(); window.history.replaceState(null, "", "/en/studio-v2"); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const message = { id: "first-message", role: "user", text: "生成一只猫" };
describe("project lifecycle", () => {
  it("signals switching immediately while saving and blocks duplicate switches and edits", async () => {
    let finishSave;
    mocks.api.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }))
      .mockResolvedValueOnce({ id: "project-b", version: 1, name: "B", content: { layers: [], messages: [], jobs: [] } });
    const { result } = renderHook(() => useStudioProject({ userId: "user", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(draft => ({ ...draft, messages: [message] })));
    let opening;
    act(() => { opening = result.current.open("project-b"); });
    expect(result.current.switching).toBe(true);
    expect(result.current.ready).toBe(false);
    act(() => result.current.update(draft => ({ ...draft, name: "Must not overwrite the outgoing snapshot" })));
    expect(result.current.draft.name).toBe("Untitled");
    await act(async () => { await expect(result.current.open("project-c")).rejects.toThrow("DOCUMENT_LOADING"); });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    await act(async () => {
      finishSave({ id: "project-a", version: 1, name: "A", content: mocks.api.mock.calls[0][1].body.content });
      await opening;
    });
    expect(result.current.switching).toBe(false);
    expect(result.current.ready).toBe(true);
    expect(result.current.draft.id).toBe("project-b");
  });
  it("keeps the outgoing project editable after a failed switch-time save", async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error("DOCUMENT_VERSION_CONFLICT"), { code: "DOCUMENT_VERSION_CONFLICT" }));
    const { result } = renderHook(() => useStudioProject({ userId: "user", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(draft => ({ ...draft, messages: [message] })));
    const key = result.current.draft.createKey;
    await act(async () => { await expect(result.current.open("project-b")).rejects.toThrow("DOCUMENT_VERSION_CONFLICT"); });
    expect(result.current.ready).toBe(true);
    expect(result.current.switching).toBe(false);
    expect(result.current.draft.createKey).toBe(key);
    expect(result.current.draft._dirty).toBe(true);
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });
  it("loads additional layer pages with at most two concurrent requests and preserves order", async () => {
    const layers = Array.from({ length: 401 }, (_, index) => ({ id: `layer-${index}` }));
    const pending = new Map();
    mocks.api.mockImplementation(url => {
      if (url.includes("pagedLayers")) return Promise.resolve({ id: "large-project", version: 1, name: "Large", layerCount: layers.length, content: { layers: layers.slice(0, 100), messages: [], jobs: [] } });
      const offset = Number(new URL(url, "https://example.test").searchParams.get("offset"));
      return new Promise(resolve => pending.set(offset, () => { pending.delete(offset); resolve({ items: layers.slice(offset, offset + 100) }); }));
    });
    const { result } = renderHook(() => useStudioProject({ userId: "user", initialDocument: "large-project", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(pending.size).toBe(2));
    expect([...pending.keys()]).toEqual([100, 200]);
    await act(async () => pending.get(200)());
    expect([...pending.keys()]).toEqual([100, 300]);
    await act(async () => pending.get(300)());
    expect([...pending.keys()]).toEqual([100, 400]);
    await act(async () => { pending.get(400)(); pending.get(100)(); });
    expect(result.current.ready).toBe(true);
    expect(result.current.draft.layers).toEqual(layers);
  });
  it("does not reload or reset an authenticated canvas during session refresh", async () => {
    mocks.api.mockResolvedValue({ id: "project-a", version: 1, name: "Cloud", content: { layers: [], messages: [], jobs: [] } });
    const { result, rerender } = renderHook(({ sessionLoading }) => useStudioProject({ userId: "user", sessionLoading, initialDocument: "project-a", paused: true, onError: vi.fn() }), { initialProps: { sessionLoading: false } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(d => ({ ...d, name: "Unsaved edit" })));
    rerender({ sessionLoading: true });
    expect(result.current.ready).toBe(true);
    rerender({ sessionLoading: false });
    await act(async () => {});
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(result.current.draft.name).toBe("Unsaved edit");
  });
  it("shows the local draft while reconciling but keeps editing gated", async () => {
    let resolve;
    mocks.read.mockResolvedValue({ id: "project-a", version: 1, name: "Cached", layers: [], messages: [message], jobs: [], appliedJobs: [] });
    mocks.api.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useStudioProject({ userId: "user", initialDocument: "project-a", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.draft.name).toBe("Cached"));
    expect(result.current.ready).toBe(false);
    act(() => result.current.update(d => ({ ...d, name: "Must not edit an unvalidated snapshot" })));
    expect(result.current.draft.name).toBe("Cached");
    await expect(result.current.save()).rejects.toThrow("DOCUMENT_LOADING");
    await act(async () => resolve({ id: "project-a", version: 2, name: "Updated", content: { layers: [], messages: [], jobs: [] } }));
    expect(result.current.ready).toBe(true);
    expect(result.current.draft.name).toBe("Updated");
  });
  it("offers a retry after loading fails and can open the same project", async () => {
    mocks.api.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ id: "project-a", version: 1, name: "Recovered", content: { layers: [], messages: [], jobs: [] } });
    const { result } = renderHook(() => useStudioProject({ userId: "user", initialDocument: "project-a", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.saveState).toBe("load-error"));
    expect(result.current.ready).toBe(false);
    await act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.draft.name).toBe("Recovered");
  });
  it("bounds stalled cloud reads and aborts reads when leaving the project", async () => {
    vi.useFakeTimers();
    let signal;
    mocks.api.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useStudioProject({ userId: "user", initialDocument: "project-a", paused: true, onError }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(result.current.saveState).toBe("load-error");
    expect(onError.mock.calls[0][0].message).toBe("DOCUMENT_LOAD_TIMEOUT");
    act(() => { void result.current.retryLoad(); });
    await act(async () => {});
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
  it("preserves grapheme clusters in prompt titles", () => {
    expect(promptTitle(" \n 生成一只猫   在窗边 ")).toBe("生成一只猫 在窗边");
    expect(promptTitle("👨‍👩‍👧‍👦猫咪", 2)).toBe("👨‍👩‍👧‍👦猫…");
  });
  it("does not create an empty cloud project", async () => {
    const { result } = renderHook(() => useStudioProject({ userId: "user", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.save());
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it("coalesces rapid local edits and flushes the latest draft on demand", async () => {
    const { result } = renderHook(() => useStudioProject({ userId: "user", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(draft => ({ ...draft, name: "First edit" })));
    act(() => result.current.update(draft => ({ ...draft, name: "Latest edit" })));
    await act(async () => result.current.flushLocal());
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0][2]).toMatchObject({ name: "Latest edit" });
  });
  it("reports local storage failure without preventing ordinary cloud saves", async () => {
    const onError = vi.fn();
    mocks.write.mockRejectedValue(new Error("QuotaExceededError"));
    mocks.api.mockImplementation(async (_url, { body }) => ({ id: "project-a", version: 1, name: body.name, content: body.content }));
    const { result } = renderHook(() => useStudioProject({ userId: "user", paused: true, onError }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(draft => ({ ...draft, messages: [message] })));
    await act(async () => { await result.current.save(); });
    expect(onError).toHaveBeenCalledWith("LOCAL_SAVE_FAILED");
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(result.current.draft.id).toBe("project-a");
    expect(result.current.saveState).toBe("saved");
  });
  it("keeps explicit durability flush failures observable to task submission", async () => {
    const { result } = renderHook(() => useStudioProject({ userId: "user", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    mocks.write.mockRejectedValue(new Error("LOCAL_SAVE_FAILED"));
    act(() => result.current.update(draft => ({ ...draft, pendingSubmit: { key: "task-key" } })));
    await act(async () => { await expect(result.current.flushLocal()).rejects.toThrow("LOCAL_SAVE_FAILED"); });
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it("keeps edits made during a save dirty and saves them at the acknowledged version", async () => {
    let resolve;
    mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockImplementationOnce(async (_url, { body }) => ({ ...body, version: 2 }));
    const { result } = renderHook(() => useStudioProject({ userId: "user", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(d => ({ ...d, name: "生成一只猫", messages: [message] })));
    let first;
    act(() => { first = result.current.save(); });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    act(() => result.current.update(d => ({ ...d, name: "手动改名", nameSource: "manual" })));
    await act(async () => { resolve({ id: "project-a", version: 1, name: "生成一只猫", content: mocks.api.mock.calls[0][1].body.content }); await first; });
    expect(result.current.draft).toMatchObject({ id: "project-a", name: "手动改名", _dirty: true });
    expect(result.current.saveState).toBe("local");
    await act(() => result.current.save());
    expect(mocks.api.mock.calls[1][1].body).toMatchObject({ id: "project-a", version: 1, name: "手动改名" });
    expect(result.current.saveState).toBe("saved");
    expect(window.location.search).toContain("document=project-a");
  });
  it("keeps an unsaved local copy when a newer server version exists", async () => {
    mocks.read.mockResolvedValue({ id: "project-a", version: 1, name: "Local", layers: [], messages: [message], jobs: [], appliedJobs: [], _dirty: true });
    mocks.api.mockResolvedValue({ id: "project-a", version: 2, name: "Remote", content: { layers: [], messages: [], jobs: [] } });
    const onError = vi.fn();
    const { result } = renderHook(() => useStudioProject({ userId: "user", initialDocument: "project-a", paused: true, onError }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.draft.name).toBe("Local");
    expect(result.current.saveState).toBe("conflict");
    expect(onError).toHaveBeenCalledWith("DOCUMENT_VERSION_CONFLICT");
  });
  it("resolves a persisted uncertain save before sending edits made after the failure", async () => {
    const pending = { id: "project-a", version: 1, saveKey: "uncertain-write", name: "Earlier", content: { layers: [], messages: [message], jobs: [] } };
    mocks.read.mockResolvedValue({ id: "project-a", version: 1, name: "Latest local edit", layers: [], messages: [message], jobs: [], appliedJobs: [], _dirty: true, _pendingSave: pending });
    mocks.api.mockResolvedValueOnce({ id: "project-a", version: 1, content: pending.content })
      .mockImplementation(async (_url, { body }) => ({ ...body, version: body.version + 1 }));
    const { result } = renderHook(() => useStudioProject({ userId: "user", initialDocument: "project-a", paused: true, onError: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.save());
    expect(mocks.api.mock.calls[1][1].body).toEqual(pending);
    expect(mocks.api.mock.calls[2][1].body).toMatchObject({ version: 2, name: "Latest local edit" });
    expect(result.current.draft).toMatchObject({ version: 3, _dirty: false });
    expect(result.current.draft._pendingSave).toBeUndefined();
  });
  it("recognizes its own committed save after reload without discarding newer local edits", async () => {
    mocks.read.mockResolvedValue({ id: "project-a", version: 1, name: "Newer local edit", layers: [], messages: [message], jobs: [], appliedJobs: [], _dirty: true,
      _pendingSave: { id: "project-a", version: 1, saveKey: "committed-write" } });
    mocks.api.mockResolvedValue({ id: "project-a", version: 2, lastSaveKey: "committed-write", content: { layers: [], messages: [], jobs: [] } });
    const onError = vi.fn();
    const { result } = renderHook(() => useStudioProject({ userId: "user", initialDocument: "project-a", paused: true, onError }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.draft).toMatchObject({ name: "Newer local edit", version: 2, _dirty: true });
    expect(result.current.saveState).toBe("local");
    expect(onError).not.toHaveBeenCalled();
  });
  it("never reports all tasks complete while an output is still loading or failed", () => {
    const jobs = [{ id: "a", status: "succeeded" }, { id: "b", status: "succeeded" }];
    expect(taskSummary(jobs, ["a"], {})).toEqual({ active: 1, failed: 0, complete: false });
    expect(taskSummary(jobs, ["a"], { b: "failed" })).toEqual({ active: 0, failed: 1, complete: false });
    expect(taskSummary(jobs, ["a", "b"], {})).toEqual({ active: 0, failed: 0, complete: true });
  });
});
