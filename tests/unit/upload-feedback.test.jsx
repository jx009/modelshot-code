// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUploadFeedback } from "../../src/hooks/useUploadFeedback.js";

const image = name => new File(["image"], name, { type: "image/png" });
beforeEach(() => {
  let sequence = 0;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => `blob:preview-${++sequence}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows local previews immediately and releases each successful upload separately", () => {
  const { result } = renderHook(() => useUploadFeedback("project"));
  let batch;
  act(() => { batch = result.current.start([image("first.png"), image("slow.png")]); });
  expect(result.current.items.map(item => item.url)).toEqual(["blob:preview-1", "blob:preview-2"]);
  act(() => { batch.update(0, "uploading"); batch.update(1, "uploading"); });
  act(() => batch.update(0, "done"));
  expect(result.current.items).toHaveLength(1);
  expect(result.current.items[0].file.name).toBe("slow.png");
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview-1");
  act(() => batch.update(1, "error", "Network error"));
  expect(result.current.items[0]).toMatchObject({ status: "error", error: "Network error" });
  act(() => result.current.dismiss(result.current.items[0].id));
  expect(result.current.items).toEqual([]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-2");
});

it("invalidates old uploads and releases blobs when switching projects or unmounting", () => {
  const view = renderHook(({ scope }) => useUploadFeedback(scope), { initialProps: { scope: "first" } });
  let previous, current;
  act(() => { previous = view.result.current.start([image("old.png")]); });
  view.rerender({ scope: "second" });
  expect(previous.isCurrent()).toBe(false);
  expect(view.result.current.items).toEqual([]);
  act(() => { current = view.result.current.start([image("new.png")]); previous.update(0, "error", "Late failure"); });
  expect(view.result.current.items[0].file.name).toBe("new.png");
  view.unmount();
  expect(current.isCurrent()).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("does not create previews for oversized or unsupported files", () => {
  const oversized = image("huge.png");
  Object.defineProperty(oversized, "size", { value: 51 * 1024 * 1024 });
  const { result } = renderHook(() => useUploadFeedback("project"));
  act(() => result.current.start([oversized, new File(["text"], "text.txt", { type: "text/plain" })]));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(result.current.items).toHaveLength(2);
});

it("clears an interrupted batch without cancelling a newer batch", () => {
  const { result } = renderHook(() => useUploadFeedback("project"));
  let previous, current;
  act(() => { previous = result.current.start([image("old.png")]); });
  act(() => { current = result.current.start([image("new.png")]); previous.cancel(); });
  expect(result.current.items[0].file.name).toBe("new.png");
  act(() => current.cancel());
  expect(result.current.items).toEqual([]);
  expect(current.isCurrent()).toBe(false);
});
