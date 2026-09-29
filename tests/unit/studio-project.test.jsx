// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioProject } from "../../src/components/studio/useStudioProject";
import { promptTitle } from "../../src/lib/studio/project-title.js";
import { taskSummary } from "../../src/lib/studio/task-presentation.js";

const mocks = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api, requestKey: () => crypto.randomUUID() }));
vi.mock("@/lib/studio/project-storage", () => ({ readProjectDraft: mocks.read, writeProjectDraft: mocks.write }));
beforeEach(() => { mocks.api.mockReset(); mocks.read.mockReset().mockResolvedValue(null); mocks.write.mockReset().mockResolvedValue(); window.history.replaceState(null, "", "/en/studio-v2"); });
afterEach(cleanup);
const message = { id: "first-message", role: "user", text: "生成一只猫" };
describe("project lifecycle", () => {
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
  it("never reports all tasks complete while an output is still loading or failed", () => {
    const jobs = [{ id: "a", status: "succeeded" }, { id: "b", status: "succeeded" }];
    expect(taskSummary(jobs, ["a"], {})).toEqual({ active: 1, failed: 0, complete: false });
    expect(taskSummary(jobs, ["a"], { b: "failed" })).toEqual({ active: 0, failed: 1, complete: false });
    expect(taskSummary(jobs, ["a", "b"], {})).toEqual({ active: 0, failed: 0, complete: true });
  });
});
