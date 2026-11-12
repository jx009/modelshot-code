// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useVideoProject from "../../src/components/video/useVideoProject";

const mocks = vi.hoisted(() => ({ api: vi.fn(), sequence: 0 }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => `recovery-request-${++mocks.sequence}`, terminalStatus: status => ["succeeded", "failed", "cancelled"].includes(status) }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/lib/upload-image", () => ({ uploadImage: vi.fn() }));
vi.mock("../../src/lib/navigation-guard", () => ({ registerNavigationGuard: () => () => {} }));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); mocks.sequence = 0; mocks.api.mockReset(); });
afterEach(cleanup);

const savedDraft = (prompt = "server prompt") => ({ name: "Video", content: { schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [], video: { mode: "video", media: [], composition: null, duration: 5, ratio: "16:9", prompt } } });

it("keeps a conflicting draft without replaying its rejected save when the user restores after reopening", async () => {
  let server = { id: "video-project", version: 1, ...savedDraft() };
  mocks.api.mockImplementation(async (url, options) => {
    if (url === "/api/video/documents/video-project") return server;
    if (url === "/api/studio/documents") {
      if (options.body.version !== server.version) throw Object.assign(new Error("DOCUMENT_VERSION_CONFLICT"), { status: 409 });
      server = { ...options.body, version: server.version + 1 }; return server;
    }
    return [];
  });
  const options = { documentId: "video-project", mode: "video", userId: "user-1" };
  const first = renderHook(() => useVideoProject(options));
  await act(async () => {});
  act(() => first.result.current.change(savedDraft("my unsaved prompt")));
  server = { ...server, version: 2, ...savedDraft("another tab's prompt") };
  await act(async () => { await expect(first.result.current.save()).rejects.toThrow("DOCUMENT_VERSION_CONFLICT"); });
  const local = JSON.parse(localStorage.getItem("video-draft:user-1:video-project"));
  expect(local.draft.content.video.prompt).toBe("my unsaved prompt");
  expect(local.pendingSave).toBeNull();
  const rejectedKey = mocks.api.mock.calls.find(([url]) => url === "/api/studio/documents")[1].body.saveKey;
  first.unmount();
  const reopened = renderHook(() => useVideoProject(options));
  await act(async () => {});
  expect(reopened.result.current.draft.content.video.prompt).toBe("another tab's prompt");
  expect(reopened.result.current.recovery.draft.content.video.prompt).toBe("my unsaved prompt");
  expect(mocks.api.mock.calls.filter(([url]) => url === "/api/studio/documents")).toHaveLength(1);
  act(() => reopened.result.current.recover());
  await act(async () => { await reopened.result.current.save(); });
  expect(server.content.video.prompt).toBe("my unsaved prompt");
  expect(server.version).toBe(3);
  expect(server.saveKey).not.toBe(rejectedKey);
});

it("retries an uncertain save with its original key and clears the save error only after acknowledgement", async () => {
  let lost = true;
  mocks.api.mockImplementation(async (url, options) => {
    if (url === "/api/studio/documents") {
      if (lost) throw new Error("REQUEST_TIMEOUT");
      return { ...options.body, id: "video-project", version: 1 };
    }
    return [];
  });
  const { result } = renderHook(() => useVideoProject({ mode: "video", userId: "user-1" }));
  act(() => result.current.change(savedDraft("keep this prompt")));
  await act(async () => { await expect(result.current.save()).rejects.toThrow("REQUEST_TIMEOUT"); });
  const pending = JSON.parse(localStorage.getItem("video-draft:user-1:video")).pendingSave;
  expect(pending.body.content.video.prompt).toBe("keep this prompt");
  expect(result.current.error).toBe("REQUEST_TIMEOUT");
  lost = false;
  await act(async () => { await result.current.save(); });
  const saves = mocks.api.mock.calls.filter(([url]) => url === "/api/studio/documents");
  expect(saves[1][1].body).toEqual(saves[0][1].body);
  expect(result.current.error).toBe("");
  expect(result.current.dirty).toBe(false);
  expect(localStorage.getItem("video-draft:user-1:video")).toBeNull();
});

it("recovers the exact original request after a lost response, even after editing the draft", async () => {
  let lost = true, version = 0;
  mocks.api.mockImplementation(async (url, options) => {
    if (url === "/api/studio/documents") return { id: "video-project", version: ++version };
    if (url === "/api/studio/jobs" && options?.method === "POST") {
      if (lost) throw new Error("connection lost");
      return { id: "same-paid-job", documentId: "video-project", status: "queued" };
    }
    return [];
  });
  const { result } = renderHook(() => useVideoProject({ mode: "video", userId: "user-1" }));
  await act(async () => { await result.current.submit("video", "original shot", { available: true, cost: 10 }); });
  const original = mocks.api.mock.calls.find(([url, options]) => url === "/api/studio/jobs" && options?.method === "POST")[1];
  expect(result.current.pendingSubmission).toBe(true);
  act(() => result.current.change(draft => ({ ...draft, content: { ...draft.content, video: { ...draft.content.video, prompt: "new draft" } } })));
  await act(async () => { await result.current.submit("video", "new draft", { available: true, cost: 10 }); });
  expect(mocks.api.mock.calls.filter(([url]) => url === "/api/studio/jobs")).toHaveLength(1);
  expect(result.current.error).toBe("VIDEO_SUBMISSION_UNCONFIRMED");
  lost = false;
  await act(async () => { await result.current.recoverSubmission(); });
  const restored = mocks.api.mock.calls.filter(([url]) => url === "/api/studio/jobs")[1][1];
  expect(restored.key).toBe(original.key);
  expect(restored.body).toEqual(original.body);
  expect(restored.body.params.prompt).toBe("original shot");
  expect(result.current.draft.content.video.prompt).toBe("new draft");
  expect(result.current.pendingSubmission).toBe(false);
});
