import { z } from "zod";
import { requireUser } from "../../../lib/require-user.js";
import { errorResponse, readJson } from "../../../lib/http.js";
import { startRecharge } from "../../../lib/domain/billing/recharge.js";

export async function POST(request) {
  try {
    const user = await requireUser();
    const input = await readJson(request, z.object({ planId: z.string().max(40), locale: z.enum(["zh", "en"]), method: z.enum(["alipay", "wxpay", "qqpay", "stripe"]), expectedAmountMinor: z.number().int().positive(), expectedCredits: z.number().int().positive() }).strict());
    return Response.json(await startRecharge(user.id, input, request.headers.get("idempotency-key")), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
