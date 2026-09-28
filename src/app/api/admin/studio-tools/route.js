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
  const providers = await prisma.modelProvider.findMany({ where: { isActive: true }, select: { name: true, displayName: true, kind: true, config: true }, orderBy: { priority: "asc" } });
  const channels = { segment: [], split: [] };
  for (const p of providers) {
    const config = JSON.parse(p.config || "{}");
    if (["dashscope", "volcengine", "fal"].includes(p.kind)) {
      const cap = config.studioCapability;
      if (cap === "segment") channels.segment.push({ name: p.name, label: p.displayName });
      else if (cap === "split") channels.split.push({ name: p.name, label: p.displayName });
    }
  }
  return Response.json({
    tools: configurable.map(tool => ({
      id: tool.id,
      zh: tool.zh,
      en: tool.en,
      dependency: tool.dependency,
      preview: tool.preview,
      creditCost: byId.get(tool.id)?.creditCost ?? tool.cost,
      isEnabled: byId.get(tool.id)?.isEnabled ?? true,
      channelName: byId.get(tool.id)?.channelName || null,
    })),
    channels,
  });
}

export async function PATCH(request) {
  try {
    const auth = await requireAdmin(request, "root");
    if (auth.response) return auth.response;
    const input = await readJson(request, z.object({
      toolId: z.enum(toolIds),
      creditCost: z.number().int().min(0).max(100000).optional(),
      isEnabled: z.boolean().optional(),
      channelName: z.string().max(128).nullable().optional(),
      reason: z.string().min(3).max(500),
    }).strict());
    if (input.creditCost === undefined && input.isEnabled === undefined && input.channelName === undefined) throw new AppError("NO_CHANGES");
    const tool = configurable.find(item => item.id === input.toolId);
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "UPDATE_STUDIO_TOOL", input, async tx => {
      const previous = await tx.studioToolConfig.findUnique({ where: { toolId: input.toolId } });
      const row = await tx.studioToolConfig.upsert({
        where: { toolId: input.toolId },
        create: { toolId: input.toolId, creditCost: input.creditCost ?? tool.cost, isEnabled: input.isEnabled ?? true, channelName: input.channelName },
        update: { creditCost: input.creditCost, isEnabled: input.isEnabled, ...(input.channelName !== undefined ? { channelName: input.channelName } : {}) },
      });
      return {
        response: { toolId: row.toolId, creditCost: row.creditCost, isEnabled: row.isEnabled, channelName: row.channelName },
        audit: { toolId: row.toolId, before: previous ? { creditCost: previous.creditCost, isEnabled: previous.isEnabled, channelName: previous.channelName } : null, after: { creditCost: row.creditCost, isEnabled: row.isEnabled, channelName: row.channelName } },
      };
    }, prisma, "root");
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
