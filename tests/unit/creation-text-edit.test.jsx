// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCanvasTextEdit } from "../../src/components/creation/editors/layout/useCanvasTextEdit";

afterEach(cleanup);
const page = () => ({ id: "page", nodes: [{ id: "title", type: "text", text: "Original", locked: false }, { id: "other", type: "text", text: "Other", locked: false }] });
function setup(overrides = {}) {
  const controllerRef = createRef(), onCommit = vi.fn(() => true), onError = vi.fn(), onPendingChange = vi.fn();
  const props = { page: page(), controllerRef, onCommit, onError, onPendingChange, readOnly: false, ...overrides };
  const hook = renderHook(value => useCanvasTextEdit(value), { initialProps: props });
  return { ...hook, props, controllerRef, onCommit, onError, onPendingChange };
}

it("flushes the latest DOM value synchronously without waiting for a render or blur, exactly once", () => {
  const { result, controllerRef, onCommit, onPendingChange } = setup();
  act(() => result.current.begin("title", "Original"));
  act(() => {
    result.current.input("最终输入");
    controllerRef.current.commitPending();
    result.current.blur();
  });
  expect(onCommit).toHaveBeenCalledExactlyOnceWith([{ op: "setText", pageId: "page", nodeId: "title", text: "最终输入" }]);
  expect(result.current.draft).toBeNull();
  expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
});

it("refuses save during IME composition and commits the final composed value after a pending blur", () => {
  const { result, controllerRef, onCommit } = setup();
  act(() => { result.current.begin("title", "Original"); result.current.compositionStart(); result.current.input("zhong"); });
  expect(() => controllerRef.current.commitPending()).toThrow("TEXT_COMPOSITION_ACTIVE");
  act(() => result.current.blur());
  expect(onCommit).not.toHaveBeenCalled();
  expect(result.current.draft.text).toBe("zhong");
  act(() => result.current.compositionEnd("中文"));
  expect(onCommit).toHaveBeenCalledExactlyOnceWith([{ op: "setText", pageId: "page", nodeId: "title", text: "中文" }]);
  expect(result.current.draft).toBeNull();
});

it("keeps rejected text visible, blocks replacing the draft, and retries without duplicate submission", () => {
  const { result, controllerRef, onCommit, onError } = setup();
  onCommit.mockReturnValue(false);
  act(() => { result.current.begin("title", "Original"); result.current.input("Retained"); result.current.blur(); });
  expect(result.current.draft.text).toBe("Retained");
  expect(onError.mock.calls.at(-1)[0].message).toBe("TEXT_EDIT_NOT_COMMITTED");
  act(() => result.current.begin("other", "Other"));
  expect(result.current.draft.nodeId).toBe("title");
  onCommit.mockClear().mockReturnValue(true);
  act(() => controllerRef.current.commitPending());
  expect(onCommit).toHaveBeenCalledOnce();
  expect(result.current.draft).toBeNull();
});

it("does not overwrite concurrent changes or discard a draft when the editor becomes read-only", () => {
  const { result, controllerRef, onCommit, rerender, props } = setup();
  act(() => { result.current.begin("title", "Original"); result.current.input("Local"); });
  rerender({ ...props, readOnly: true });
  expect(() => controllerRef.current.commitPending()).toThrow("TEXT_EDIT_NOT_COMMITTED");
  expect(result.current.draft.text).toBe("Local");
  rerender({ ...props, page: { ...props.page, nodes: [{ ...props.page.nodes[0], text: "Other edit" }] } });
  expect(() => controllerRef.current.commitPending()).toThrow("TEXT_EDIT_TARGET_CHANGED");
  expect(onCommit).not.toHaveBeenCalled();
  expect(result.current.draft.text).toBe("Local");
  rerender({ ...props, page: { ...props.page, nodes: [] } });
  expect(() => controllerRef.current.commitPending()).toThrow("TEXT_EDIT_TARGET_CHANGED");
  expect(result.current.draft.node.id).toBe("title");
  expect(result.current.draft.text).toBe("Local");
});

it("reports pending state only on transitions, and explicit cancel submits nothing", () => {
  const { result, onCommit, onPendingChange } = setup();
  act(() => { result.current.begin("title", "Original"); result.current.input("A"); result.current.input("AB"); result.current.input("ABC"); });
  expect(onPendingChange.mock.calls).toEqual([[true]]);
  act(() => result.current.cancel());
  expect(result.current.draft).toBeNull();
  expect(onCommit).not.toHaveBeenCalled();
  expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
});

it("closes an unchanged draft without creating a history item", () => {
  const { result, controllerRef, onCommit } = setup();
  act(() => { result.current.begin("title", "Original"); controllerRef.current.commitPending(); });
  expect(result.current.draft).toBeNull();
  expect(onCommit).not.toHaveBeenCalled();
});

it("retains the original page identity when an external page change reuses the same node ID", () => {
  const onDraftChange = vi.fn();
  const { result, controllerRef, onCommit, rerender, props } = setup({ onDraftChange });
  act(() => { result.current.begin("title", "Original"); result.current.input("Pending original page"); });
  rerender({ ...props, page: { ...page(), id: "different-page" } });
  expect(() => controllerRef.current.commitPending()).toThrow("TEXT_EDIT_TARGET_CHANGED");
  expect(controllerRef.current.getPendingText().pageId).toBe("page");
  act(() => result.current.input("Still belongs to original page"));
  expect(onDraftChange.mock.calls.at(-1)[0].pageId).toBe("page");
  expect(onCommit).not.toHaveBeenCalled();
  rerender(props);
  act(() => controllerRef.current.commitPending());
  expect(onCommit).toHaveBeenCalledWith([{ op: "setText", pageId: "page", nodeId: "title", text: "Still belongs to original page" }]);
});
it("journals only compact pending text, including composition, and clears it after commit", () => {
  const onDraftChange = vi.fn(), { result, controllerRef } = setup({ onDraftChange });
  act(() => result.current.begin("title", "Original")); expect(onDraftChange).not.toHaveBeenCalled();
  act(() => { result.current.compositionStart(); result.current.input("zhong"); });
  expect(onDraftChange).toHaveBeenLastCalledWith({ pageId: "page", nodeId: "title", original: "Original", text: "zhong", composing: true });
  expect(controllerRef.current.getPendingText()).toEqual(onDraftChange.mock.calls.at(-1)[0]);
  act(() => { result.current.compositionEnd("中"); controllerRef.current.commitPending(); });
  expect(onDraftChange).toHaveBeenLastCalledWith(null); expect(controllerRef.current.getPendingText()).toBeNull();
});
