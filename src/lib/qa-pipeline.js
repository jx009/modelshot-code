import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const QA_PROMPT = `You are a quality inspector for AI-generated fashion product images.
Analyze this image and check for these issues:
1. BODY_DISTORTION: Any unnatural body proportions, extra fingers, missing limbs
2. GARMENT_MISMATCH: Does the garment look significantly different from the reference?
3. LOGO_MISSING: Any text/logo/pattern that should be there but is missing or garbled
4. COLOR_SHIFT: Significant color difference from the reference garment
5. FACE_DISTORTION: Unnatural facial features

Respond in JSON format:
{
  "score": 0.0-1.0 (overall quality, 1.0 = perfect),
  "pass": true/false (true if score >= 0.7),
  "flags": ["BODY_DISTORTION", ...] (list of detected issues, empty if none)
}`;

/**
 * 把本地 /uploads/xx.png 路径读成 data URI（OpenAI vision API 无法访问 localhost）
 */
async function toDataUri(source) {
  if (!source) return null;
  if (source.startsWith("data:")) return source;
  if (source.startsWith("http")) return source;
  if (source.startsWith("/")) {
    const filepath = path.join(process.cwd(), "public", source.replace(/^\//, ""));
    const buf = await fs.readFile(filepath);
    const ext = path.extname(filepath).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  // 纯 base64
  return `data:image/png;base64,${source}`;
}

/**
 * 自动 QA 检测（GPT-4o-mini 视觉，~$0.002/张）
 *
 * @param {string} generatedImage - 生成图（本地 /uploads 路径 / data URI / http URL）
 * @param {string} referenceImage - 参考服装图（可空）
 * @returns {Promise<{score: number, pass: boolean, flags: string[]}>}
 *
 * QA 失败不阻塞生图流程——默认通过并打 QA_ERROR/QA_SKIPPED 标记
 */
export async function runQA(generatedImage, referenceImage) {
  // 未配置 OpenAI key → 跳过 QA
  if (!process.env.OPENAI_API_KEY) {
    return { score: null, pass: true, flags: ["QA_SKIPPED"] };
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const generatedUri = await toDataUri(generatedImage);
    const referenceUri = await toDataUri(referenceImage);
    if (!generatedUri) return { score: 0.5, pass: true, flags: ["QA_NO_IMAGE"] };

    const content = [
      { type: "text", text: QA_PROMPT },
      { type: "image_url", image_url: { url: generatedUri, detail: "low" } },
    ];
    if (referenceUri) {
      content.push({ type: "text", text: "Reference garment image:" });
      content.push({ type: "image_url", image_url: { url: referenceUri, detail: "low" } });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      max_tokens: 200,
    });

    const result = JSON.parse(response.choices[0].message.content);
    const score = typeof result.score === "number" ? result.score : 0.5;
    return {
      score,
      pass: result.pass !== undefined ? Boolean(result.pass) : score >= 0.7,
      flags: Array.isArray(result.flags) ? result.flags : [],
    };
  } catch (error) {
    console.error("[QA] Error:", error.message);
    // QA 失败不应阻塞生图流程，默认通过
    return { score: null, pass: true, flags: ["QA_ERROR"] };
  }
}
