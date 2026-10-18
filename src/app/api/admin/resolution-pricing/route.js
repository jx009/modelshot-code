import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { readJson, errorResponse } from "@/lib/http";
import { setSiteConfig, invalidateSiteConfig } from "@/lib/site-config";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { getResolutionSurcharges, resolutionPricingSchema } from "@/lib/domain/billing/resolution-pricing";

const inputSchema = z.object({ surcharges: resolutionPricingSchema, reason: z.string().trim().min(3).max(500) }).strict();
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try { return Response.json({ surcharges: await getResolutionSurcharges(), canManage: auth.user.role === "root" }, { headers }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request) {
  const auth = await requireAdmin(request, "root");
  if (auth.response) return auth.response;
  try {
    const input = await readJson(request, inputSchema);
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "UPDATE_RESOLUTION_PRICING", input, async tx => {
      const before = await getResolutionSurcharges(tx);
      await setSiteConfig("image_resolution_pricing", JSON.stringify(input.surcharges), tx);
      return { response: { surcharges: input.surcharges }, audit: { before, after: input.surcharges } };
    }, prisma, "root");
    invalidateSiteConfig();
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
