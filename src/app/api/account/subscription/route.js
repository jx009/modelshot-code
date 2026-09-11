import { z } from "zod";
import { requireUser } from "../../../../lib/require-user.js";
import { errorResponse, readJson } from "../../../../lib/http.js";
import { requestSubscriptionChange } from "../../../../lib/domain/billing/subscription-changes.js";

export async function POST(request) {
  try {
    const user = await requireUser();
    const input = await readJson(request, z.object({ subscriptionId: z.string().max(128), action: z.enum(["cancel", "resume", "change"]), planId: z.enum(["sub_standard", "sub_pro"]).optional() }).strict());
    const operation = await requestSubscriptionChange(user.id, input, request.headers.get("idempotency-key"));
    return Response.json({ ok: true, id: operation.id, state: operation.state });
  } catch (error) { return errorResponse(error); }
}
