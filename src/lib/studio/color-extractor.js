// Cache for extracted colors
const colorCache = new Map();
const MAX_CACHE_SIZE = 50;

/**
 * Extract dominant colors from an image with caching
 * @param {string} imageSrc - Image URL or data URL
 * @param {number} colorCount - Number of colors to extract (default 3)
 * @returns {Promise<string[]>} Array of hex color strings
 */
export async function extractDominantColors(imageSrc, colorCount = 3) {
  // Check cache first
  const cacheKey = `${imageSrc}:${colorCount}`;
  if (colorCache.has(cacheKey)) {
    return colorCache.get(cacheKey);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const maxDimension = 100; // Downsample for performance
        const scale = Math.min(maxDimension / img.width, maxDimension / img.height);

        canvas.width = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;

        // Simple color quantization
        const colors = quantizeColors(pixels, colorCount);

        // Cache the result
        if (colorCache.size >= MAX_CACHE_SIZE) {
          // Remove oldest entry
          const firstKey = colorCache.keys().next().value;
          colorCache.delete(firstKey);
        }
        colorCache.set(cacheKey, colors);

        resolve(colors);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageSrc;
  });
}

/**
 * Quantize colors using a simple frequency-based approach
 * @param {Uint8ClampedArray} pixels - RGBA pixel data
 * @param {number} count - Number of colors to extract
 * @returns {string[]} Array of hex color strings
 */
function quantizeColors(pixels, count) {
  const colorMap = new Map();

  // Sample every 4th pixel for performance
  for (let i = 0; i < pixels.length; i += 16) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    // Skip transparent pixels
    if (a < 128) continue;

    // Reduce color space to 32 levels per channel for clustering
    const rBucket = Math.floor(r / 8) * 8;
    const gBucket = Math.floor(g / 8) * 8;
    const bBucket = Math.floor(b / 8) * 8;

    const key = `${rBucket},${gBucket},${bBucket}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }

  // Sort by frequency and take top N
  const sorted = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);

  // Convert to hex
  return sorted.map(([key]) => {
    const [r, g, b] = key.split(",").map(Number);
    return rgbToHex(r, g, b);
  });
}

/**
 * Convert RGB to hex color
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} Hex color string
 */
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

/**
 * Check if a color is suitable as an accent (not too dark or too light)
 * @param {string} hex - Hex color string
 * @returns {boolean} True if suitable
 */
export function isSuitableAccent(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  // Calculate relative luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;

  // Accent should be neither too dark nor too light
  return luminance > 0.2 && luminance < 0.8;
}

/**
 * Convert hex to RGB
 * @param {string} hex - Hex color string
 * @returns {{r: number, g: number, b: number} | null}
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}
