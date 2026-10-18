import sharp from "sharp";
import { AppError } from "../../http.js";
import { editOutputSize, editTargetSize, expansionEdges } from "../../studio/edit-geometry.js";
import { maskPixels } from "./pixels.js";

export async function greenEditGuide(image, mask) {
  const { width, height } = await sharp(image).metadata();
  const selected = await maskPixels(mask, width, height);
  const pixels = await sharp(image).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < selected.length; i++) if (selected[i] > 16) {
    pixels[i * 4] = 0; pixels[i * 4 + 1] = 255; pixels[i * 4 + 2] = 0; pixels[i * 4 + 3] = 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function runGuidedEdit(config, snapshot, original, mask, signal, generate, references = [], { onPrepared } = {}) {
  const { tool, params } = snapshot;
  if (config.imageKind === "dashscope" && references.length > 1) throw new AppError("TOO_MANY_EDIT_REFERENCES", 422);
  const meta = await sharp(original).metadata();
  const target = editTargetSize(tool, meta, params.padding);
  const output = editOutputSize(config, params.size, target);
  if (output.error) throw new AppError(output.error, 422);
  const edges = tool === "expand" ? expansionEdges(params.padding) : null;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(target.width, target.height);
  const ratio = `${target.width / divisor}:${target.height / divisor}`;
  const inputMode = tool === "expand" ? "green-expansion-canvas" : "single-green-guide";
  const prompt = tool === "expand" ? [
    `将这张图片的绿色区域自然补全为原场景的延伸，目标比例 ${ratio}，目标画幅 ${target.width}×${target.height}。绿色只是扩展区域标记，不能出现在结果中。`,
    `原图位于目标画布的左侧 ${edges.left}、顶部 ${edges.top} 像素处，原图尺寸 ${meta.width}×${meta.height}。扩展边距：左 ${edges.left}、右 ${edges.right}、上 ${edges.top}、下 ${edges.bottom} 像素。`,
    "保留原有主体、构图、比例和细节，只向指定方向自然延伸场景，匹配原图光线、透视和质感。不要裁切、拉伸、重复主体，也不要用模糊或纯色填充。",
    params.prompt ? `补充要求：${params.prompt}` : "",
    "只输出一张完整图片，不要边框、标记、拼贴或文字说明。",
  ].filter(Boolean).join("\n") : [
    "对第一张图片进行局部修改：纯绿色涂抹区域是需要修改的选区，绿色只是位置标记，不是成品内容。",
    `修改要求：${params.prompt || "删除选区内的物体，用周围背景自然补全。"}`,
    "只编辑标记区域，保持其余主体、布局、光线、透视和风格。如果要求删除，必须删除目标并补全真实背景，不能用模糊、涂抹或色块遮盖。",
    references.length ? "后续图片仅作为用户提供的参考，不要把它们拼贴到成品。" : "",
    "输出一张完整的修改后图片，不要保留绿色标记、边框或文字说明。",
  ].filter(Boolean).join("\n");
  // Match the observed reference frontend: a green canvas with the source at
  // its actual offset (expand), or green strokes on a white-backed source
  // (inpaint), exported as JPEG quality .99 with a 3072px longest edge.
  const marked = tool === "expand"
    ? await sharp(original).extend({ ...edges, background: "#00ff00" }).flatten({ background: "#00ff00" }).png().toBuffer()
    : await greenEditGuide(original, mask);
  const image = await sharp(marked).flatten({ background: "white" })
    .resize({ width: 3072, height: 3072, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 99, chromaSubsampling: "4:4:4" }).toBuffer();
  const inputMeta = await sharp(image).metadata();
  const edit = { tool, originalPrompt: params.prompt, instruction: prompt, targetWidth: target.width,
    targetHeight: target.height, providerSize: output.dimensions, inputMode, inputFormat: "jpeg",
    inputWidth: inputMeta.width, inputHeight: inputMeta.height };
  await onPrepared?.({ ...edit, inputCount: 1 + references.length, maskSent: false });
  // One request, one primary image, no implicit second guide or native mask.
  // Resolve auto resolution against the TARGET, not the unexpanded source image.
  const result = await generate(config, { image, references, prompt, size: output.choice, sizeSource: target, signal });
  const actual = await sharp(result).metadata();
  if (!actual.width || !actual.height) throw new AppError("INVALID_IMAGE", 422);
  // Deliver the provider image intact: cropping a guessed gray frame can remove
  // generated content, and rejecting a rounded ratio loses an otherwise valid result.
  return { images: [result], placement: "append", edit: { ...edit, actualWidth: actual.width, actualHeight: actual.height,
    ...(Math.abs((actual.width / actual.height) / (target.width / target.height) - 1) > .025 ? { warning: "PROVIDER_ASPECT_RATIO_DIFFERENT" } : {}) } };
}
