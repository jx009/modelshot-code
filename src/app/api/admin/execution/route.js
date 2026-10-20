import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { readJson, errorResponse } from "@/lib/http";
import { executionSchema, getExecutionConfig } from "@/lib/infra/execution-config";
import { setSiteConfig, invalidateSiteConfig } from "@/lib/site-config";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { prisma } from "@/lib/prisma";
export async function GET(request) {
  const auth = await requireAdmin(request); if (auth.response) return auth.response;
  try { return Response.json({ config: await getExecutionConfig(), canManage: auth.user.role === "root" }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request) {
  const auth = await requireAdmin(request, "root"); if (auth.response) return auth.response;
  try {
    const input = await readJson(request, z.object({ config: executionSchema, reason: z.string().trim().min(3).max(500) }).strict());
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "UPDATE_EXECUTION_LIMITS", input, async tx => {
      const before = await getExecutionConfig(tx);
      await setSiteConfig("execution_limits", JSON.stringify(input.config), tx);
      return { audit: { before, after: input.config } };
    }, prisma, "root");
    invalidateSiteConfig(); return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
