import { expect, it } from "vitest";
import { DEFAULT_PREVIEW_VIEW, zoomPreview } from "../../src/lib/studio/preview-transform.js";

it("keeps the image point under the mouse stationary while zooming", () => {
  const view = { ...DEFAULT_PREVIEW_VIEW, x: 80, y: -20 };
  const anchor = { x: 210, y: 90 };
  const next = zoomPreview(view, 1.5, anchor);
  expect((anchor.x - next.x) / next.zoom).toBe((anchor.x - view.x) / view.zoom);
  expect((anchor.y - next.y) / next.zoom).toBe((anchor.y - view.y) / view.zoom);
  expect(zoomPreview(next, .75, anchor)).toEqual(view);
});
it("clamps to usable limits without allowing zero or negative image dimensions", () => {
  expect(zoomPreview(DEFAULT_PREVIEW_VIEW, -1).zoom).toBe(.1);
  expect(zoomPreview(DEFAULT_PREVIEW_VIEW, 100).zoom).toBe(8);
  expect(zoomPreview({ ...DEFAULT_PREVIEW_VIEW, rotation: 90, flipX: true }, 1)).toMatchObject({ rotation: 90, flipX: true });
});
