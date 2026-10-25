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
