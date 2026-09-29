import { z } from "zod";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { languageCall } from "@/lib/domain/studio/language";
import { studioConfig, vision } from "@/lib/domain/studio/providers";

const inputSchema = z.object({ prompt: z.string().trim().min(1).max(4000) }).strict();

export async function POST(request) {
  try {
    const user = await requireUser(), data = await readJson(request, inputSchema);
    await rateLimit("studio-optimize", user.id, 30, 3600);
    const config = await studioConfig();
    const result = await languageCall(user.id, "studio-optimize", data, request.headers.get("idempotency-key"), config, async () => {
      const prompt = (await vision(config, {
        instruction: "Rewrite the user's image-generation prompt with clear subject, composition, lighting, material and style details. Preserve the requested facts, text, language and intent. Do not invent product claims or change the task. Return only the improved prompt, at most 4000 characters, without commentary or a plan. The user's prompt follows in consecutive messages.",
        messages: [{ role: "user", text: data.prompt.slice(0, 2000) }, ...(data.prompt.length > 2000 ? [{ role: "user", text: data.prompt.slice(2000) }] : [])],
        finalInstruction: "Return the improved image prompt only.",
        signal: AbortSignal.timeout(45000),
      })).trim();
      if (!prompt || prompt.length > 4000) throw new AppError("INVALID_OPTIMIZED_PROMPT", 502);
      return { prompt };
    });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
