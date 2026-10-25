import { z } from "zod";

export const posterDesignSchema = z.object({
  concept: z.string().max(1200), composition: z.string().max(1200),
  typography: z.string().max(1200), imageTreatment: z.string().max(1200),
}).strict();

// A bounded composition brief shared by image and HTML generation. This is
// local planning: it adds no paid model call or new image-generation step.
export function posterDesignContext({ width, height }) {
  const short = Math.min(width, height);
  return {
    orientation: width > height * 1.15 ? "landscape" : height > width * 1.15 ? "portrait" : "square",
    safeMargin: Math.max(1, Math.round(short * 0.055)),
    headlineSize: Math.max(1, Math.round(short * 0.095)),
    bodySize: Math.max(1, Math.round(short * 0.028)),
    composition: "Choose one clear focal point and a deliberate reading order: headline, supporting message, then details/action. Adapt to the requested aspect ratio and copy density; do not fill every region.",
  };
}

export const posterDesignGuide = `Plan the poster before writing HTML: identify its audience, one main message, exact required copy, visual focal point, text-safe region and palette. Record a concise plan in metadata.design as {concept,composition,typography,imageTreatment}. These fields are short strings (<=1200 characters each), not visible poster copy. Use the supplied compositionGuide pixel sizes as starting points and adapt them to the actual copy. Favor strong editorial hierarchy, intentional whitespace and a small number of expressive elements over generic dashboards, repeated rounded cards, or unrelated decoration. Choose a composition suited to the subject: oversized typography, asymmetric image/text, full-bleed visual with a readable text region, or restrained editorial layout. Respect explicit user style and placement instructions.
The visual and all lettering are separate layers. Preserve the subject/product and its aspect ratio; crop deliberately with object-fit/object-position, never stretch. If visualAssetId exists, use it as the focal visual and position copy in its quiet region or on a deliberate contrast surface. No fake logos, QR codes, labels, or invented assets. Without images, create an intentional typographic/vector composition, not an empty placeholder.
Keep important content inside safe margins; use border-box sizing and explicit line-height, no essential text clipping, ellipsis or hidden overflow as a substitute for fitting copy. Preserve every requested date, price and contact detail. Main headline dominates, supporting text remains legible at fit-to-screen scale. Set foreground and background colors together, independent of the surrounding editor's light/dark theme. Use CSS var(--creation-primary), var(--creation-accent), var(--creation-background), var(--creation-font) for theme-linked values. Keep decorative shapes separate from editable text. Before returning, check hierarchy, text contrast, copy completeness and dimensions.`;
