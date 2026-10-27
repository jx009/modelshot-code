// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HtmlPreviewFrame from "../../src/components/creation/editors/html/HtmlPreviewFrame";

afterEach(cleanup);
const html = text => `<html><head></head><body><p data-node-id="title">${text}</p></body></html>`;
it("keeps the iframe and its initial srcDoc across edits, late assets, and undo", () => {
  const frameRef = createRef(), onUpdate = vi.fn();
  const view = render(<HtmlPreviewFrame html={html("Initial")} frameRef={frameRef} onUpdate={onUpdate} title="Artwork" />);
  const frame = frameRef.current;
  // jsdom does not navigate srcDoc. Seed the initial document and signal load.
  frame.contentDocument.body.innerHTML = '<p data-node-id="title">Initial</p>';
  fireEvent.load(frame);
  const title = frame.contentDocument.querySelector("p");
  for (const text of ["Edited", "Image arrived", "Initial"]) {
    view.rerender(<HtmlPreviewFrame html={html(text)} frameRef={frameRef} onUpdate={onUpdate} title="Artwork" />);
    expect(frameRef.current).toBe(frame);
    expect(frame.getAttribute("srcdoc")).toBe(html("Initial"));
    expect(frame.contentDocument.querySelector("p")).toBe(title);
    expect(title.textContent).toBe(text);
  }
  expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
  expect(onUpdate).toHaveBeenCalled();
});

it("applies the newest projection if it arrives before the initial frame loads", () => {
  const frameRef = createRef(), onUpdate = vi.fn();
  const view = render(<HtmlPreviewFrame html={html("Initial")} frameRef={frameRef} onUpdate={onUpdate} />);
  view.rerender(<HtmlPreviewFrame html={html("Latest")} frameRef={frameRef} onUpdate={onUpdate} />);
  fireEvent.load(frameRef.current);
  expect(frameRef.current.contentDocument.body.textContent).toBe("Latest");
  expect(frameRef.current.getAttribute("srcdoc")).toBe(html("Initial"));
});
it("reconciles transient typing when a commit and undo return to the same source HTML", () => {
  const frameRef = createRef(), onUpdate = vi.fn();
  const view = render(<HtmlPreviewFrame html={html("Original")} revision={0} frameRef={frameRef} onUpdate={onUpdate} />);
  frameRef.current.contentDocument.body.innerHTML = '<p data-node-id="title">Original</p>';
  fireEvent.load(frameRef.current);
  const paragraph = frameRef.current.contentDocument.querySelector("p"); paragraph.textContent = "Typed locally";
  view.rerender(<HtmlPreviewFrame html={html("Original")} revision={1} frameRef={frameRef} onUpdate={onUpdate} />);
  expect(frameRef.current.contentDocument.querySelector("p")).toBe(paragraph);
  expect(paragraph.textContent).toBe("Original");
});

it("removes transient editor styles before patching and rebinds only after the new document is applied", () => {
  const frameRef = createRef(), onUpdate = vi.fn();
  const onBeforeUpdate = vi.fn(() => {
    expect(frameRef.current.contentDocument.body.textContent).toBe("Initial");
    frameRef.current.contentDocument.querySelector("p").style.removeProperty("outline");
  });
  const view = render(<HtmlPreviewFrame html={html("Initial")} frameRef={frameRef} onUpdate={onUpdate} onBeforeUpdate={onBeforeUpdate} />);
  frameRef.current.contentDocument.body.innerHTML = '<p data-node-id="title" style="outline:2px solid blue">Initial</p>';
  fireEvent.load(frameRef.current); onUpdate.mockClear();
  view.rerender(<HtmlPreviewFrame html={html("Updated")} frameRef={frameRef} onUpdate={onUpdate} onBeforeUpdate={onBeforeUpdate} />);
  expect(onBeforeUpdate).toHaveBeenCalledOnce(); expect(onUpdate).toHaveBeenCalledOnce();
  expect(onBeforeUpdate.mock.invocationCallOrder[0]).toBeLessThan(onUpdate.mock.invocationCallOrder[0]);
  expect(frameRef.current.contentDocument.body.textContent).toBe("Updated");
  expect(frameRef.current.contentDocument.querySelector("p").style.outline).toBe("");
});
