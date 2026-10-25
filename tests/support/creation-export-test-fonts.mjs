// Test processes only. Production still requires the five Noto families in its
// export image. Windows SC fonts have different family names; Consolas stands
// in for Mono in this local fixture, never in an actual deployment.
import { existsSync } from "node:fs";
import { FontLibrary } from "skia-canvas";

export const localFontAliases = [];
const registerFont = FontLibrary.use.bind(FontLibrary);
if (process.platform === "win32") {
  const aliases = {
    "Noto Sans CJK SC": "C:/Windows/Fonts/NotoSansSC-VF.ttf",
    "Noto Serif CJK SC": "C:/Windows/Fonts/NotoSerifSC-VF.ttf",
    "Noto Sans Mono": "C:/Windows/Fonts/consola.ttf",
  };
  for (const [family, path] of Object.entries(aliases)) {
    if (!FontLibrary.has(family) && existsSync(path)) { registerFont(family, path); localFontAliases.push(family); }
  }
}
