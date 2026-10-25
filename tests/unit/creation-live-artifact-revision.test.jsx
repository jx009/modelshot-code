// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLiveArtifactRevision } from "../../src/components/creation/useLiveArtifactRevision";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const defaults = { target: 20, revision: 17, ready: true, status: "saved", canApply: () => true };
it("retries a deferred refresh without another run event and stops once caught up", async () => {
  vi.useFakeTimers();
  const refreshRemote = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  renderHook(() => useLiveArtifactRevision({ ...defaults, refreshRemote }));
  await act(async () => {});
  expect(refreshRemote).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refreshRemote).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(refreshRemote).toHaveBeenCalledTimes(2);
});
it("backs off after a failed read while leaving the editor available", async () => {
  vi.useFakeTimers();
  const refreshRemote = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(true);
  renderHook(() => useLiveArtifactRevision({ ...defaults, refreshRemote }));
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refreshRemote).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refreshRemote).toHaveBeenCalledTimes(2);
});
it("cancels stale targets, waits for local saves, and aborts on unmount", async () => {
  const refreshRemote = vi.fn().mockImplementation(() => new Promise(() => {}));
  const { rerender, unmount } = renderHook(props => useLiveArtifactRevision({ ...defaults, refreshRemote, ...props }), { initialProps: { target: 20 } });
  const first = refreshRemote.mock.calls[0][1].signal;
  rerender({ target: 21 });
  expect(first.aborted).toBe(true);
  expect(refreshRemote.mock.calls[1][0]).toBe(21);
  const second = refreshRemote.mock.calls[1][1].signal;
  rerender({ target: 21, status: "saving" });
  expect(second.aborted).toBe(true);
  expect(refreshRemote).toHaveBeenCalledTimes(2);
  rerender({ target: 21, status: "saved" });
  expect(refreshRemote).toHaveBeenCalledTimes(3);
  const last = refreshRemote.mock.calls[2][1].signal;
  unmount();
  expect(last.aborted).toBe(true);
});
