// @vitest-environment jsdom
import { createRef, useImperativeHandle, useRef, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useHtmlInteractions from "../../src/components/creation/editors/html/useHtmlInteractions";
import { pendingTextOperations } from "../../src/lib/creation/client/pending-text.js";
import { applyHtmlWithInverse } from "../../src/lib/creation/html/operations.js";

beforeEach(() => {
  vi.stubGlobal("CSS", { escape: value => value });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const markup = '<p data-node-id="title">Hello <b data-node-id="bold">world</b></p><img data-node-id="photo" src="asset:photo">';
function setup() {
  let content = { schemaVersion: 3, kind: "slides", pages: [{ id: "page", width: 100, height: 100, html: markup }] }, draft;
  const edits = vi.fn(), errors = vi.fn(), controller = createRef();
  function Harness() {
    const frame = useRef(null), [selection, setSelection] = useState([]);
    const interactions = useHtmlInteractions({
      frame, page: content.pages[0], selection, setSelection, getContent: () => content, readOnly: false, onMeasure: () => {}, onError: errors,
      stageDraft: value => { draft = { format: "html-text", pageId: value.pageId, nodeId: value.nodeId, ...value.rich }; },
      commitPending: () => { if (draft) { const operations = pendingTextOperations(content, draft); if (operations.length) { edits(operations); content = applyHtmlWithInverse(content, operations).document; } draft = null; } },
      edit: mutate => { const doc = new DOMParser().parseFromString(content.pages[0].html, "text/html"); mutate(doc, selection); edits(doc.body.innerHTML); },
    });
    useImperativeHandle(controller, () => interactions);
    return <iframe title="fixture" ref={frame} onLoad={interactions.loaded} />;
  }
  const view = render(<Harness />), frame = view.getByTitle("fixture");
  frame.contentDocument.body.innerHTML = markup;
  fireEvent.load(frame);
  return { frame, controller, edits, errors, content: () => content };
}
it("keeps typing local and commits rich text once, even when saving immediately before blur", () => {
  const fixture = setup(), node = fixture.frame.contentDocument.querySelector("p");
  fireEvent.doubleClick(node);
  node.lastElementChild.textContent = "中文"; fireEvent.input(node);
  expect(fixture.edits).not.toHaveBeenCalled();
  act(() => fixture.controller.current.finishText());
  fireEvent.focusOut(node);
  act(() => fixture.controller.current.finishText());
  expect(fixture.errors).not.toHaveBeenCalled(); expect(fixture.edits).toHaveBeenCalledOnce();
  expect(fixture.content().pages[0].html).toContain("中文");
  expect(fixture.content().pages[0].html).toContain('src="asset:photo"');
});
it("defers a commit during IME composition and permits it after composition ends", () => {
  const fixture = setup(), node = fixture.frame.contentDocument.querySelector("p");
  fireEvent.doubleClick(node); fireEvent.compositionStart(node);
  node.textContent = "中文输入"; fireEvent.input(node);
  expect(() => fixture.controller.current.finishText()).toThrow("TEXT_COMPOSITION_ACTIVE");
  expect(fixture.edits).not.toHaveBeenCalled();
  fireEvent.compositionEnd(node); act(() => fixture.controller.current.finishText());
  expect(fixture.edits).toHaveBeenCalledOnce();
});
it("discarding live text restores the preview and cannot restage it on a later blur", async () => {
  const fixture = setup(), node = fixture.frame.contentDocument.querySelector("p");
  fireEvent.doubleClick(node); node.textContent = "discard me"; fireEvent.input(node);
  act(() => fixture.controller.current.discardText());
  await act(async () => fireEvent.focusOut(node));
  expect(node.textContent).toBe("Hello world");
  expect(node.hasAttribute("contenteditable")).toBe(false);
  expect(fixture.edits).not.toHaveBeenCalled();
});
it("journals a pointer move only on release and cancels native image dragging", () => {
  const fixture = setup(), node = fixture.frame.contentDocument.querySelector("img");
  const pointer = (type, x, buttons) => { const event = new MouseEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: 0 }); Object.defineProperty(event, "pointerId", { value: 1 }); fireEvent(node, event); };
  pointer("pointerdown", 0, 1); pointer("pointermove", 30, 1);
  expect(fixture.edits).not.toHaveBeenCalled(); pointer("pointerup", 30, 0);
  expect(fixture.edits).toHaveBeenCalledOnce(); expect(fixture.edits.mock.calls[0][0]).toContain("left: 30px");
  const drag = new Event("dragstart", { bubbles: true, cancelable: true }); fireEvent(node, drag);
  expect(drag.defaultPrevented).toBe(true);
});
