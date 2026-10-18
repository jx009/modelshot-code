// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CanvasArtwork from "../../src/components/studio/canvas/CanvasArtwork";
import { loadImage } from "@/lib/studio/image-processor";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const nodes = vi.hoisted(() => ({ image: vi.fn() }));
vi.mock("react-konva", () => ({
  Layer: ({ children }) => <div>{children}</div>,
  Image: props => { nodes.image(props); return null; },
  Transformer: () => null, Text: () => null, Rect: () => null,
  Group: ({ children }) => <div>{children}</div>,
}));
vi.mock("@/lib/studio/image-processor", () => ({ loadImage: vi.fn().mockResolvedValue({ naturalWidth: 200, naturalHeight: 150 }) }));

it("browses with previews and fetches an original only for a sustained selected zoom", async () => {
  vi.useFakeTimers();
  const props = { layers: [{ id: "large", type: "image", assetId: "large-photo", visible: true, x: 0, y: 0, width: 800, height: 600, pixelWidth: 4096, pixelHeight: 3072 }], camera: { x: 0, y: 0, scale: 1 }, dimensions: { width: 800, height: 600 }, selectedId: "large", interactive: false, accent: "#fff", onError: vi.fn(), onPreview: vi.fn(), onSelect: vi.fn(), onChange: vi.fn() };
  const view = render(<CanvasArtwork {...props} />);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(loadImage.mock.calls.map(([url]) => url)).toEqual(["/api/assets/large-photo?preview=1280"]);
  view.rerender(<CanvasArtwork {...props} camera={{ x: 0, y: 0, scale: 2 }} />);
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(loadImage).toHaveBeenCalledTimes(1);
  view.rerender(<CanvasArtwork {...props} />);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(loadImage).toHaveBeenCalledTimes(1);
  view.rerender(<CanvasArtwork {...props} camera={{ x: 0, y: 0, scale: 2 }} />);
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect(loadImage.mock.calls.map(([url]) => url)).toEqual(["/api/assets/large-photo?preview=1280", "/api/assets/large-photo"]);
  expect(props.onError).not.toHaveBeenCalled();
});

it("skips unchanged image nodes while retaining individual selection and geometry updates", async () => {
  const layers = Array.from({ length: 64 }, (_, i) => ({ id: `layer-${i}`, type: "image", assetId: "fixture", visible: true, x: i % 8 * 20, y: Math.floor(i / 8) * 20, width: 20, height: 20 }));
  const props = { layers, camera: { x: 0, y: 0, scale: 1 }, dimensions: { width: 800, height: 600 }, selectedId: null, interactive: true, accent: "#fff", onError: vi.fn(), onPreview: vi.fn(), onSelect: vi.fn(), onChange: vi.fn() };
  const view = render(<CanvasArtwork {...props} />);
  await waitFor(() => expect(nodes.image.mock.calls.filter(([props]) => props.image).length).toBe(64));
  nodes.image.mockClear();
  // Camera changes still need visibility checks, but not a render of each image.
  view.rerender(<CanvasArtwork {...props} camera={{ x: 2, y: 2, scale: 1.01 }} />);
  expect(nodes.image).not.toHaveBeenCalled();
  view.rerender(<CanvasArtwork {...props} selectedId="layer-3" />);
  expect(nodes.image).toHaveBeenCalledTimes(1);
  nodes.image.mockClear();
  const next = layers.map(layer => layer.id === "layer-3" ? { ...layer, width: 50 } : layer);
  view.rerender(<CanvasArtwork {...props} layers={next} selectedId="layer-3" />);
  expect(nodes.image).toHaveBeenCalledTimes(1);
  const node = nodes.image.mock.calls[0][0];
  expect(node.width).toBe(50);
  node.onClick();
  expect(props.onSelect).toHaveBeenCalledWith("layer-3");
  node.onDragEnd({ target: { x: () => 90, y: () => 80 } });
  expect(props.onChange).toHaveBeenCalledWith("layer-3", { x: 90, y: 80 });
  view.unmount();
});
