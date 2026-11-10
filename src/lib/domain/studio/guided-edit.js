import sharp from "sharp";
import { AppError } from "../../http.js";
import { editOutputSize, editTargetSize, expansionEdges } from "../../studio/edit-geometry.js";
import { alphaMask, compositeSelection, expandInput, maskPixels } from "./pixels.js";
import { editFrame, restoreEditFrame } from "./edit-frame.js";

async function nativeEdit(config, snapshot, original, mask, signal, generate, references, onPrepared) {
  const { tool, params } = snapshot;
  const meta = await sharp(original).metadata();
  const target = editTargetSize(tool, meta, params.padding), output = editOutputSize(config, params.size, target);
  if (output.error) throw new AppError(output.error, 422);
  const prepared = tool === "expand" ? await expandInput(original, params.padding) : { image: original, mask };
  let selection = prepared.mask;
  if (params.feather) {
    const originalSelection = await maskPixels(selection, target.width, target.height);
    const blurred = await sharp(originalSelection, { raw: { width: target.width, height: target.height, channels: 1 } }).blur(Math.max(.3, params.feather / 3)).greyscale().raw().toBuffer();
    // Fade inside the selected region. Outside pixels stay strictly protected.
    for (let i = 0; i < blurred.length; i++) blurred[i] = Math.min(originalSelection[i], blurred[i]);
    selection = await sharp(blurred, { raw: { width: target.width, height: target.height, channels: 1 } }).png().toBuffer();
  }
  const providerMask = await alphaMask(selection, target.width, target.height);
  const [outputWidth, outputHeight] = output.dimensions.split("x").map(Number);
  const frame = Math.abs(outputWidth / outputHeight - target.width / target.height) > .001
    ? await editFrame(prepared.image, providerMask, output.dimensions) : null;
  const prompt = `${tool === "expand" ? "Extend the scene naturally into the transparent border. Preserve the original subject, proportions, lighting and perspective." : "Edit only the transparent masked region, maintaining scene continuity."}\n${params.prompt || "Reconstruct the selected region naturally."}`;
  const edit = { tool, inputMode: "native-mask", maskSent: true, preserveOutside: Boolean(params.preserveOutside), feather: params.feather || 0, targetWidth: target.width, targetHeight: target.height, providerSize: output.dimensions };
  await onPrepared?.(edit);
  let result = await generate(config, { image: frame?.image || prepared.image, mask: frame?.mask || providerMask, references, prompt: prompt + (frame ? "\nKeep the outer gray padding unchanged; edit only the image inside it." : ""), size: output.choice, sizeSource: target, signal });
  if (frame) result = await restoreEditFrame(result, frame);
  const actual = await sharp(result).metadata();
  if (!actual.width || !actual.height || Math.abs((actual.width / actual.height) / (target.width / target.height) - 1) > .025) throw new AppError("EDIT_GEOMETRY_MISMATCH", 422);
  if (params.preserveOutside) result = await compositeSelection(prepared.image, result, selection);
  return { images: [result], placement: "append", edit: { ...edit, actualWidth: params.preserveOutside ? target.width : actual.width, actualHeight: params.preserveOutside ? target.height : actual.height } };
}

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
  // Jobs admitted before strategy snapshots keep their original guide protocol.
  if (snapshot.imageEditStrategy === "native-mask") return nativeEdit(config, snapshot, original, mask, signal, generate, references, onPrepared);
  if (params.preserveOutside || params.feather) throw new AppError("EDIT_STRATEGY_UNSUPPORTED", 422);
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
  // Compatibility fallback for channels without a verified native mask
  // protocol. This is ModelShot's guide strategy, not a Jimeng API claim.
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
