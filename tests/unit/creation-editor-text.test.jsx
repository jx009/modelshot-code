// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanTextChildren, formatTextRange, insertPlainText, textEditTarget } from "../../src/lib/creation/html/editor-text.js";

afterEach(() => { document.body.replaceChildren(); document.getSelection().removeAllRanges(); });
it("edits the enclosing text object without entering neighbouring media or layout", () => {
  document.body.innerHTML = '<div data-node-id="layout"><h1 data-node-id="title">Hello <b data-node-id="bold">world</b></h1><img data-node-id="photo"></div>';
  expect(textEditTarget(document.querySelector("b"))).toBe(document.querySelector("h1"));
  expect(textEditTarget(document.querySelector("img"))).toBeNull();
  expect(textEditTarget(document.querySelector("div"))).toBeNull();
});
it("formats only selected characters, strips editor-only attributes, and pastes literal text", () => {
  document.body.innerHTML = '<p data-node-id="text">Hello world</p>';
  const node = document.querySelector("p"), range = document.createRange();
  range.setStart(node.firstChild, 6); range.setEnd(node.firstChild, 11);
  formatTextRange(node, "fontWeight", "700", range);
  expect(node.firstChild.textContent).toBe("Hello ");
  const span = node.querySelector("span"); expect(span.textContent).toBe("world");
  span.dataset.nodeId = "cloned"; span.contentEditable = "true"; span.setAttribute("data-cw-selected", "true");
  const source = document.implementation.createHTMLDocument();
  source.body.replaceChildren(...cleanTextChildren(node, source));
  expect(source.body.innerHTML).not.toMatch(/data-node-id|data-cw-|contenteditable/);
  expect(insertPlainText(node, "<img src=x>中文")).toBe(true);
  expect(node.textContent).toBe("Hello <img src=x>中文"); expect(node.querySelector("img")).toBeNull();
});
