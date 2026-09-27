import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { TOOLS } from "@/lib/studio/tools";

const configurable = TOOLS.filter(tool => !["generate", "edit"].includes(tool.id));
const toolIds = configurable.map(tool => tool.id);

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const rows = await prisma.studioToolConfig.findMany();
  const byId = new Map(rows.map(row => [row.toolId, row]));
  return Response.json(configurable.map(tool => ({
    id: tool.id,
    zh: tool.zh,
    en: tool.en,
    dependency: tool.dependency,
    creditCost: byId.get(tool.id)?.creditCost ?? tool.cost,
    isEnabled: byId.get(tool.id)?.isEnabled ?? true,
  })));
}

export async function PATCH(request) {
  try {
    const auth = await requireAdmin(request, "root");
    if (auth.response) return auth.response;
    const input = await readJson(request, z.object({
      toolId: z.enum(toolIds),
      creditCost: z.number().int().min(0).max(100000).optional(),
      isEnabled: z.boolean().optional(),
      reason: z.string().min(3).max(500),
    }).strict());
    if (input.creditCost === undefined && input.isEnabled === undefined) throw new AppError("NO_CHANGES");
    const tool = configurable.find(item => item.id === input.toolId);
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "UPDATE_STUDIO_TOOL", input, async tx => {
      const previous = await tx.studioToolConfig.findUnique({ where: { toolId: input.toolId } });
      const row = await tx.studioToolConfig.upsert({
        where: { toolId: input.toolId },
        create: { toolId: input.toolId, creditCost: input.creditCost ?? tool.cost, isEnabled: input.isEnabled ?? true },
        update: { creditCost: input.creditCost, isEnabled: input.isEnabled },
      });
      return {
        response: { toolId: row.toolId, creditCost: row.creditCost, isEnabled: row.isEnabled },
        audit: { toolId: row.toolId, before: previous ? { creditCost: previous.creditCost, isEnabled: previous.isEnabled } : null, after: { creditCost: row.creditCost, isEnabled: row.isEnabled } },
      };
    }, prisma, "root");
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
