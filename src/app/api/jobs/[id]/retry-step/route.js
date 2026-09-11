import { z } from "zod";
import { requireUser } from "../../../../../lib/require-user.js";
import { errorResponse, readJson } from "../../../../../lib/http.js";
import { retryStep } from "../../../../../lib/domain/generation/exports.js";

export async function POST(request, context) {
  try {
    const user = await requireUser();
    const { kind } = await readJson(request, z.object({ kind: z.enum(["qa", "delivery"]) }).strict());
    const { id } = await context.params;
    return Response.json(await retryStep(user.id, id, kind));
  } catch (error) { return errorResponse(error); }
}
