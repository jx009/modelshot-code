// @vitest-environment jsdom
import { expect, it } from "vitest";
import { patchHtmlPreview } from "../../src/lib/creation/html/patch-preview.js";

it("keeps decoded image nodes while text, styles and layer order change", () => {
  const doc = new DOMParser().parseFromString('<html><head></head><body><p data-node-id="title">Before</p><img data-node-id="photo" src="data:," /></body></html>', "text/html");
  const photo = doc.querySelector("img"), title = doc.querySelector("p");
  patchHtmlPreview(doc, '<html><head></head><body><img data-node-id="photo" src="data:," /><p data-node-id="title" style="left:20px">After</p></body></html>');
  expect(doc.querySelector("img")).toBe(photo);
  expect(doc.querySelector("p")).toBe(title);
  expect(title.textContent).toBe("After");
  expect(title.style.left).toBe("20px");
  expect(doc.body.firstChild).toBe(photo);
});

it("preserves unfinished typing when images arrive and reconciles insertions/deletions", () => {
  const doc = new DOMParser().parseFromString('<html><head></head><body><p data-node-id="title" contenteditable="plaintext-only">Typing</p><span data-node-id="old">Old</span></body></html>', "text/html");
  const title = doc.querySelector("p");
  patchHtmlPreview(doc, '<html><head></head><body><p data-node-id="title">Saved</p><img data-node-id="photo" src="data:," /></body></html>');
  expect(title.textContent).toBe("Typing");
  expect(title.hasAttribute("contenteditable")).toBe(true);
  expect(doc.querySelector("span")).toBeNull();
  expect(doc.querySelector("img")).not.toBeNull();
  title.removeAttribute("contenteditable");
  patchHtmlPreview(doc, '<html><head></head><body><p data-node-id="title">Committed</p></body></html>');
  expect(title.textContent).toBe("Committed");
  expect(doc.body.children).toHaveLength(1);
});
