// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRemoteResource } from "../../src/hooks/useRemoteResource.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("remote resource loading", () => {
  it("ignores an older response after filters change", async () => {
    const requests = [];
    vi.stubGlobal("fetch", vi.fn((url, options) => new Promise(resolve => requests.push({ url, ...options, resolve }))));
    const { result, rerender } = renderHook(({ url }) => useRemoteResource(url), { initialProps: { url: "/orders?page=2" } });
    rerender({ url: "/orders?page=1&q=new" });
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => requests[1].resolve({ ok: true, json: async () => ({ page: 1 }) }));
    await act(async () => requests[0].resolve({ ok: true, json: async () => ({ page: 2 }) }));
    expect(result.current.data).toEqual({ page: 1 });
    expect(result.current.loading).toBe(false);
  });
  it("surfaces HTTP errors and can reload the same query", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => [] }));
    const { result } = renderHook(() => useRemoteResource("/orders"));
    await waitFor(() => expect(result.current.error?.message).toContain("503"));
    act(() => result.current.reload());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.error).toBeNull();
  });
  it("aborts on unmount", () => {
    let signal;
    vi.stubGlobal("fetch", vi.fn((url, options) => { signal = options.signal; return new Promise(() => {}); }));
    const { unmount } = renderHook(() => useRemoteResource("/orders"));
    unmount();
    expect(signal.aborted).toBe(true);
  });
  it("retains the visible record during background refresh", async () => {
    let finish;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })));
    const { result } = renderHook(() => useRemoteResource("/job/1"));
    await waitFor(() => expect(result.current.data?.status).toBe("running"));
    act(() => result.current.reload());
    expect(result.current.data.status).toBe("running");
    await act(async () => finish({ ok: true, json: async () => ({ status: "succeeded" }) }));
    expect(result.current.data.status).toBe("succeeded");
  });
});
