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
