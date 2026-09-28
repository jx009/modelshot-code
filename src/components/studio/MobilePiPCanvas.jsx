"use client";

import { Stage, Layer, Image as CanvasImage, Text, Group, Rect } from "react-konva";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { loadImage, processLargeImage } from "@/lib/studio/image-processor";

function PicturePreview({ item }) {
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (item.type !== "image" || !item.assetId) return;
    let live = true;
    loadImage(`/api/assets/${item.assetId}`)
      .then(img => processLargeImage(img, 2048))
      .then(processed => { if (live) setImage(processed); })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item.assetId, item.type]);

  if (item.type === "image") {
    return (
      <CanvasImage
        image={image}
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        rotation={item.rotation || 0}
        opacity={item.opacity ?? 1}
      />
    );
  }

  if (item.type === "text") {
    return (
      <Text
        text={item.text || ""}
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        fontSize={item.fontSize || 36}
        fill={item.fill || "#D9F154"}
        rotation={item.rotation || 0}
        opacity={item.opacity ?? 1}
      />
    );
  }

  return (
    <Group x={item.x} y={item.y} rotation={item.rotation || 0} opacity={item.opacity ?? 1}>
      <Rect width={item.width} height={item.height} fill="#D9F154" opacity={0.13} cornerRadius={12} />
      <Text
        text="▶ VIDEO"
        width={item.width}
        align="center"
        y={item.height / 2 - 10}
        fill="#D9F154"
        fontSize={22}
      />
    </Group>
  );
}

export function MobilePiPCanvas({ isVisible, onClose, layers }) {
  if (!isVisible) return null;

  const visibleLayers = layers.filter((l) => l.visible);

  // Calculate bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  visibleLayers.forEach((l) => {
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + l.width);
    maxY = Math.max(maxY, l.y + l.height);
  });

  const contentWidth = maxX - minX || 800;
  const contentHeight = maxY - minY || 600;
  const scale = Math.min(128 / contentWidth, 96 / contentHeight);

  return (
    <div className="fixed bottom-20 right-4 w-32 h-24 rounded-lg overflow-hidden border-2 border-primary shadow-xl z-50 bg-bg-elevated">
      <Stage
        width={128}
        height={96}
        scaleX={scale}
        scaleY={scale}
        x={-minX * scale + (128 - contentWidth * scale) / 2}
        y={-minY * scale + (96 - contentHeight * scale) / 2}
      >
        <Layer>
          {visibleLayers.map((layer) => (
            <PicturePreview key={layer.id} item={layer} />
          ))}
        </Layer>
      </Stage>
      <button
        onClick={onClose}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
        aria-label="Close picture-in-picture"
      >
        <X size={12} />
      </button>
    </div>
  );
}
