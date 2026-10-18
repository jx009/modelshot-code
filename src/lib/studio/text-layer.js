export const TEXT_LIMIT = 8000;
export const TEXT_LINE_HEIGHT = 1.5;

// Use the same character wrapping as the canvas. The fallback also works in
// server-side validation/tests, without importing the canvas rendering library.
export function textLayerHeight(text, width = 440, fontSize = 24, measure) {
  let lines = 1, lineWidth = 0;
  for (const character of Array.from(text || "")) {
    if (character === "\n") { lines++; lineWidth = 0; continue; }
    const advance = measure ? measure(character) : fontSize * (character.charCodeAt(0) > 255 ? 1 : .65);
    if (lineWidth && lineWidth + advance > width) { lines++; lineWidth = 0; }
    lineWidth += advance;
  }
  return Math.min(8192, Math.max(fontSize * TEXT_LINE_HEIGHT, Math.ceil((lines + 1) * fontSize * TEXT_LINE_HEIGHT)));
}
