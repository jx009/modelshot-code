import { useState, useEffect } from "react";
import { extractDominantColors, isSuitableAccent } from "@/lib/studio/color-extractor";

/**
 * Extract and manage dynamic colors from image layers
 * @param {Array} layers - Canvas layers
 * @param {string} selectedId - Currently selected layer ID
 * @returns {{colors: string[], primaryColor: string | null, applyColors: () => void}}
 */
export function useImageColors(layers, selectedId) {
  const [colors, setColors] = useState([]);
  const [primaryColor, setPrimaryColor] = useState(null);

  useEffect(() => {
    // Skip on server-side
    if (typeof window === "undefined") return;

    const selectedLayer = layers.find(l => l.id === selectedId);

    // Only extract colors from image layers
    if (!selectedLayer || selectedLayer.type !== "image" || !selectedLayer.assetId) {
      return;
    }

    let cancelled = false;

    // Delay extraction to avoid blocking initial render
    const timer = setTimeout(() => {
      extractDominantColors(`/api/assets/${selectedLayer.assetId}`, 5)
        .then(extractedColors => {
          if (cancelled) return;

          // Filter suitable accent colors
          const suitable = extractedColors.filter(isSuitableAccent);

          setColors(suitable);
          setPrimaryColor(suitable[0] || null);
        })
        .catch(() => {
          // Silently fail - color extraction is optional
          if (!cancelled) {
            setColors([]);
            setPrimaryColor(null);
          }
        });
    }, 300); // Delay 300ms to prioritize initial render

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [layers, selectedId]);

  /**
   * Apply extracted colors to CSS custom properties
   */
  const applyColors = () => {
    // Skip on server-side
    if (typeof window === "undefined" || !primaryColor) return;

    const root = document.documentElement;

    // Apply primary color as accent
    root.style.setProperty("--primary", primaryColor);

    // Generate lighter/darker variants
    const rgb = hexToRgb(primaryColor);
    if (rgb) {
      // Muted variant (30% opacity)
      root.style.setProperty("--primary-muted", `${primaryColor}4D`);

      // Hover variant (slightly lighter)
      const lighter = adjustBrightness(rgb, 1.1);
      root.style.setProperty("--primary-hover", rgbToHex(lighter.r, lighter.g, lighter.b));
    }
  };

  return { colors, primaryColor, applyColors };
}

/**
 * Convert hex to RGB object
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Convert RGB to hex string
 */
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => {
    const clamped = Math.max(0, Math.min(255, Math.round(x)));
    const hex = clamped.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

/**
 * Adjust brightness of RGB color
 */
function adjustBrightness(rgb, factor) {
  return {
    r: rgb.r * factor,
    g: rgb.g * factor,
    b: rgb.b * factor
  };
}
