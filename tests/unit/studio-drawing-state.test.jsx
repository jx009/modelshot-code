// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDrawingState } from "../../src/components/studio/canvas/hooks/useDrawingState";

describe("useDrawingState", () => {
  it("coalesces dense pointer samples without growing an unbounded path", () => {
    const { result } = renderHook(() => useDrawingState());

    act(() => {
      result.current.startStroke({ x: 0, y: 0 }, "image:mask", 35);
      for (let index = 0; index < 20_000; index += 1) {
        // The repeated samples model a fast pointer that reports many events
        // at the same pixel before the browser paints the next frame.
        result.current.addPoint({ x: 100, y: 100 });
      }
      result.current.endStroke();
    });

    expect(result.current.strokes).toHaveLength(1);
    expect(result.current.strokes[0].points).toHaveLength(6);
    expect(result.current.isDrawing).toBe(false);
  });

  it("bounds a long stroke while retaining its beginning and end samples", () => {
    const { result } = renderHook(() => useDrawingState());

    act(() => {
      result.current.startStroke({ x: 0, y: 0 }, "image:mask", 35);
      for (let index = 1; index <= 10_000; index += 1) result.current.addPoint({ x: index, y: 0 });
      result.current.endStroke();
    });

    const points = result.current.strokes[0].points;
    expect(points.length).toBeLessThanOrEqual(16_384);
    expect(points[0]).toBe(0);
    expect(points[points.length - 2]).toBe(10_000);
  });
});
