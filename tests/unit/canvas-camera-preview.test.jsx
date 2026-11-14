// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCanvasState } from "../../src/components/studio/canvas/hooks/useCanvasState.js";

const dimensions = { width: 800, height: 600 };
const stageNode = () => ({ position: vi.fn(), scale: vi.fn(), batchDraw: vi.fn() });

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] }));
afterEach(() => vi.useRealTimers());

test("wheel preview draws once per frame and commits React state only after settling", () => {
  const { result } = renderHook(() => useCanvasState(dimensions, []));
  const node = stageNode();
  act(() => {
    for (let i = 0; i < 5; i++) result.current.previewCamera(node, current => ({ ...current, scale: current.scale * 1.1 }));
  });
  expect(result.current.camera.scale).toBe(1);
  expect(result.current.cameraMoving).toBe(true);
  act(() => vi.advanceTimersToNextFrame());
  expect(node.batchDraw).toHaveBeenCalledTimes(1);
  expect(node.scale).toHaveBeenLastCalledWith({ x: expect.closeTo(1.61051, 4), y: expect.closeTo(1.61051, 4) });
  act(() => vi.advanceTimersByTime(130));
  expect(result.current.camera.scale).toBeCloseTo(1.61051, 4);
  expect(result.current.cameraMoving).toBe(false);
});

test("a pan that ends before the zoom settles keeps the previewed scale", () => {
  const { result } = renderHook(() => useCanvasState(dimensions, []));
  act(() => result.current.previewCamera(stageNode(), current => ({ ...current, scale: 2 })));
  act(() => result.current.updateCamera({ x: 100, y: 50 }));
  expect(result.current.camera).toEqual({ x: 100, y: 50, scale: 2 });
  act(() => vi.advanceTimersByTime(200));
  expect(result.current.camera).toEqual({ x: 100, y: 50, scale: 2 });
});
