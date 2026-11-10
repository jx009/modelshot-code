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
