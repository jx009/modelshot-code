import sharp from "sharp";
import { AppError } from "../../http.js";
import { editOutputSize } from "../../studio/edit-geometry.js";
import { alphaMask, expandInput, maskPixels } from "./pixels.js";
import { editFrame, restoreEditFrame } from "./edit-frame.js";

export async function greenEditGuide(image, mask) {
  const { width, height } = await sharp(image).metadata();
  const selected = await maskPixels(mask, width, height);
  const pixels = await sharp(image).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < selected.length; i++) if (selected[i] > 16) {
    pixels[i * 4] = 0; pixels[i * 4 + 1] = 255; pixels[i * 4 + 2] = 0; pixels[i * 4 + 3] = 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function runGuidedEdit(config, snapshot, original, mask, signal, generate, references = []) {
  const { tool, params } = snapshot;
  if (config.imageKind === "dashscope" && references.length > 1) throw new AppError("TOO_MANY_EDIT_REFERENCES", 422);
  const source = tool === "expand" ? await expandInput(original, params.padding) : { image: original, mask };
  const meta = await sharp(source.image).metadata();
  const output = editOutputSize(config, params.size, meta);
  if (output.error) throw new AppError(output.error, 422);
  const nativeMask = await alphaMask(source.mask, meta.width, meta.height);
  const frame = await editFrame(source.image, nativeMask, output.dimensions);
  const guide = await greenEditGuide(source.image, source.mask);
  const guideFrame = await editFrame(guide, nativeMask, output.dimensions);
  const geometry = `Target canvas before outer padding: ${meta.width}x${meta.height}. Editing canvas rectangle in the supplied image: ${JSON.stringify(frame.content)}. Image 2 shows the exact placement of the original within this canvas. Do not move, scale, duplicate or reframe existing subjects.`;
  const intent = params.prompt || (tool === "expand" ? "Extend the surrounding scene naturally." : "Remove the selected object and reconstruct its background.");
  const prompt = [
    "Edit IMAGE 1 in place. IMAGE 2 is a spatial guide: pure green marks the area to reconstruct, not a color to retain. Additional images are user references, not panels to add.",
    tool === "expand" ? "Fill only the indicated outer area with a seamless continuation of the scene. Keep the existing subject positions, scale, lighting, perspective and depth of field. Do not repeat objects at the boundary."
      : "Apply the requested edit to the indicated area. If the request is removal, remove the entire selected target and reconstruct the underlying background; do not blur, smear or cover it. Preserve all unrelated subjects and details.",
    geometry, `User edit instruction: ${intent}`,
    "Return ONE complete edited image with the same canvas and outer gray padding, without green marks, selection outlines, borders, collages or reference thumbnails. Preserve the scene outside the requested edit.",
  ].join("\n");
  // Cloud APIs consume the explicit guide; native OpenAI edits also get an alpha mask.
  const generated = await generate(config, { image: frame.image, references: [guideFrame.image, ...references],
    ...(!["volcengine", "dashscope"].includes(config.imageKind) ? { mask: frame.mask } : {}), prompt, size: output.choice, signal });
  // Deliver the complete result. Never paste the original center over a newly composed image.
  const result = await restoreEditFrame(generated, frame);
  if (tool === "expand") {
    const selected = await maskPixels(source.mask, meta.width, meta.height);
    const alpha = await sharp(result).ensureAlpha().extractChannel("alpha").raw().toBuffer();
    let area = 0, empty = 0;
    for (let i = 0; i < selected.length; i++) if (selected[i] > 127) { area++; if (alpha[i] < 240) empty++; }
    if (empty > area * 0.01) throw new AppError("EDIT_INCOMPLETE", 422);
  }
  return { images: [result], placement: "append", edit: { tool, originalPrompt: params.prompt,
    instruction: prompt, targetWidth: meta.width, targetHeight: meta.height, providerSize: output.dimensions, inputMode: "source-and-green-guide" } };
}
