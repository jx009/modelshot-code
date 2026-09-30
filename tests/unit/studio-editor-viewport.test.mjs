import { describe, it, expect } from "vitest";
import { editorCamera } from "../../src/lib/studio/editor-viewport.js";

describe("tool viewport keeps the entire image above its controls", () => {
  const area = { left: 24, top: 108, width: 326, height: 210 };
  it.each([[2000, 400], [400, 2000], [8000, 8000]])("fits %s × %s without clipping on mobile", (width, height) => {
    const item = { x: -1200, y: 950, width, height };
    const c = editorCamera(item, area);
    expect(c.x + item.x * c.scale).toBeGreaterThanOrEqual(area.left - 1e-6);
    expect(c.y + item.y * c.scale).toBeGreaterThanOrEqual(area.top - 1e-6);
    expect(c.x + (item.x + width) * c.scale).toBeLessThanOrEqual(area.left + area.width + 1e-6);
    expect(c.y + (item.y + height) * c.scale).toBeLessThanOrEqual(area.top + area.height + 1e-6);
  });
  it("reserves space for asymmetric expansion around a rotated image", () => {
    const item = { x: 300, y: -150, width: 300, height: 150, pixelWidth: 600, pixelHeight: 300, rotation: 90 };
    const c = editorCamera(item, area, { left: 200, top: 100, right: 400, bottom: 200 });
    // Local expanded bounds [-100,-50] to [500,250], rotated by 90°.
    for (const [x, y] of [[350, -250], [50, 350]]) {
      expect(c.x + x * c.scale).toBeGreaterThanOrEqual(area.left - 1e-6);
      expect(c.x + x * c.scale).toBeLessThanOrEqual(area.left + area.width + 1e-6);
      expect(c.y + y * c.scale).toBeGreaterThanOrEqual(area.top - 1e-6);
      expect(c.y + y * c.scale).toBeLessThanOrEqual(area.top + area.height + 1e-6);
    }
  });
});
