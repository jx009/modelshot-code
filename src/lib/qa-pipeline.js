import OpenAI from "openai";
import { z } from "zod";
import { toDataUri } from "./ai/adapters/base.js";

export const qualityReportSchema = z.object({
  score: z.number().min(0).max(1),
  flags: z.array(z.enum(["BODY_DISTORTION", "GARMENT_MISMATCH", "LOGO_MISSING", "COLOR_SHIFT", "FACE_DISTORTION"])).max(5),
  evidence: z.string().min(1).max(2000),
}).strict();

export async function runQA(generatedImage, referenceImage, { skip = false, client } = {}) {
  if (!Buffer.isBuffer(generatedImage) || !Buffer.isBuffer(referenceImage)) return { status: "error", score: null, flags: [], errorCode: "QA_MISSING_IMAGE" };
  if (skip || !client && (!process.env.OPENAI_API_KEY || process.env.QA_ENABLED !== "1")) return { status: "skipped", score: null, flags: [] };
  try {
    const api = client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 45_000 });
    const response = await api.chat.completions.create({
      model: "gpt-4o-mini", max_tokens: 800, response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: 'Compare the generated fashion image with the reference garment. Check anatomy, garment silhouette, logos, patterns and color. Return only JSON: {"score": number from 0 to 1, "flags": array containing only BODY_DISTORTION, GARMENT_MISMATCH, LOGO_MISSING, COLOR_SHIFT, FACE_DISTORTION as applicable, "evidence": specific visual reasons}. Do not assume details which are not visible.' },
        { type: "image_url", image_url: { url: toDataUri(generatedImage), detail: "high" } },
        { type: "text", text: "Reference garment:" },
        { type: "image_url", image_url: { url: toDataUri(referenceImage), detail: "high" } },
      ] }],
    });
    const report = qualityReportSchema.parse(JSON.parse(response.choices[0].message.content));
    return { status: report.score >= 0.7 && !report.flags.length ? "passed" : "needs_review", ...report };
  } catch { return { status: "error", score: null, flags: [], errorCode: "QA_SERVICE_ERROR" }; }
}
