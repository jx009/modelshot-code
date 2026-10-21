import { expect, it, vi } from "vitest";
import { clipboardImageFiles, imagePasteDestination } from "../../src/lib/studio/image-paste.js";

it("reads image files without importing the same clipboard item twice", () => {
  const image = { type: "image/png", name: "screenshot.png" };
  const getAsFile = vi.fn(() => image);
  expect(clipboardImageFiles({ files: [image, { type: "text/plain" }], items: [{ kind: "file", type: image.type, getAsFile }] })).toEqual([image]);
  expect(getAsFile).not.toHaveBeenCalled();
});

it("falls back to clipboard items and ignores text and empty file entries", () => {
  const image = { type: "image/jpeg", name: "photo.jpg" };
  expect(clipboardImageFiles({ items: [
    { kind: "string", type: "text/html" },
    { kind: "file", type: "image/jpeg", getAsFile: () => image },
    { kind: "file", type: "image/png", getAsFile: () => null },
  ] })).toEqual([image]);
  expect(clipboardImageFiles(null)).toEqual([]);
});

it("leaves unsupported image types for the shared upload validator to reject", () => {
  const gif = { type: "image/gif" };
  expect(clipboardImageFiles({ files: [gif] })).toEqual([gif]);
});

it("routes the canvas and creative prompt but leaves other editors and dialogs alone", () => {
  expect(imagePasteDestination({})).toBe("canvas");
  expect(imagePasteDestination({ isContentEditable: true })).toBeNull();
  expect(imagePasteDestination({ closest: selector => selector.includes("input,") ? {} : null })).toBeNull();
  expect(imagePasteDestination({ closest: selector => selector.includes("data-image-paste") ? {} : null })).toBe("reference");
  expect(imagePasteDestination({ closest: () => ({}) })).toBeNull();
});
