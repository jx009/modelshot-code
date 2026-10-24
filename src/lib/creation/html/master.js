import { layoutThemeSchema } from "../contracts/layout.js";
export { htmlMasterSchema } from "./document.js";
export function themeStyles(value) {
  const theme = layoutThemeSchema.parse(value), font = { sans: 'Arial,"Microsoft YaHei",sans-serif', serif: 'Georgia,"Noto Serif CJK SC",serif', mono: 'Consolas,monospace' }[theme.fontFamily];
  return `:root{--creation-primary:${theme.primary};--creation-accent:${theme.accent};--creation-background:${theme.background};--creation-font:${font}}`;
}
