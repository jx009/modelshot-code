import { z } from "zod";
import { requireUser } from "../../../lib/require-user.js";
import { errorResponse, readJson } from "../../../lib/http.js";
import { submitGeneration } from "../../../lib/domain/generation/submission.js";

const schema = z.object({ quoteId: z.string().min(16).max(128), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function POST(request) {
  try {
    const user = await requireUser();
    const input = await readJson(request, schema);
    return Response.json(await submitGeneration(user.id, input.quoteId, input.digest, request.headers.get("idempotency-key")), { status: 202 });
  } catch (error) { return errorResponse(error); }
}
