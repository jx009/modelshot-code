// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStudioJobs } from "../../src/components/studio/useStudioJobs.js";

const mocks = vi.hoisted(() => ({ api: vi.fn(), streams: [] }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
beforeEach(() => {
  mocks.api.mockReset(); mocks.streams.length = 0;
  vi.stubGlobal("EventSource", class {
    close = vi.fn();
    constructor(url) { this.url = url; mocks.streams.push(this); }
    addEventListener(_event, listener) { this.receive = listener; }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const props = () => ({ documentId: "project-a", ready: true, userId: "owner", revision: 0, onJobs: vi.fn(), onResult: vi.fn(async () => {}), onUsage: vi.fn() });

it("wakes an idle project's subscription when a submission advances the revision", async () => {
  let rows = [];
  mocks.api.mockImplementation(async url => url === "/api/usage" ? {} : rows);
  const options = props();
  const view = renderHook(options => useStudioJobs(options), { initialProps: options });
  await act(async () => {});
  expect(mocks.streams).toHaveLength(0);
  rows = [{ id: "new-job", status: "queued" }];
  view.rerender({ ...options, revision: 1 });
  await waitFor(() => expect(mocks.streams).toHaveLength(1));
  const finished = { id: "new-job", status: "succeeded" };
  await act(async () => mocks.streams[0].receive({ data: JSON.stringify([finished]) }));
  expect(options.onResult).toHaveBeenCalledWith(finished);
  expect(mocks.streams[0].close).toHaveBeenCalled();
  rows = [{ id: "next-job", status: "queued" }];
  view.rerender({ ...options, revision: 2 });
  await waitFor(() => expect(mocks.streams).toHaveLength(2));
  expect(options.onJobs).toHaveBeenLastCalledWith(rows);
});

it("ignores a late snapshot from the pre-submission request", async () => {
  let resolveOld;
  mocks.api.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockImplementation(async url => url === "/api/usage" ? {} : [{ id: "new-job", status: "queued" }]);
  const options = props();
  const view = renderHook(options => useStudioJobs(options), { initialProps: options });
  view.rerender({ ...options, revision: 1 });
  await waitFor(() => expect(mocks.streams).toHaveLength(1));
  await act(async () => resolveOld([{ id: "old-job", status: "succeeded" }]));
  expect(options.onJobs).toHaveBeenCalledTimes(1);
  expect(options.onResult).not.toHaveBeenCalledWith(expect.objectContaining({ id: "old-job" }));
  view.unmount();
  expect(mocks.streams[0].close).toHaveBeenCalled();
});

it("does not reconnect for identical props or repeated snapshots", async () => {
  const rows = [{ id: "job", status: "running" }];
  mocks.api.mockImplementation(async url => url === "/api/usage" ? {} : rows);
  const options = props();
  const view = renderHook(options => useStudioJobs(options), { initialProps: options });
  await waitFor(() => expect(mocks.streams).toHaveLength(1));
  view.rerender({ ...options });
  await act(async () => mocks.streams[0].receive({ data: JSON.stringify(rows) }));
  expect(options.onJobs).toHaveBeenCalledTimes(1);
  expect(mocks.streams).toHaveLength(1);
});

it("falls back to polling after a stream failure and stops at completion", async () => {
  vi.useFakeTimers();
  let rows = [{ id: "job", status: "running" }];
  mocks.api.mockImplementation(async url => url === "/api/usage" ? {} : rows);
  const options = props();
  renderHook(() => useStudioJobs(options));
  await act(async () => {});
  act(() => mocks.streams[0].onerror());
  rows = [{ id: "job", status: "succeeded" }];
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(options.onResult).toHaveBeenLastCalledWith(rows[0]);
  const count = mocks.api.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(mocks.api).toHaveBeenCalledTimes(count);
});
