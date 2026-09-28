import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { channelCapability, toolRouting, supportsImageTask } from "@/lib/studio/model-channels";
import { TOOLS } from "@/lib/studio/tools";

const configurable = TOOLS.filter(tool => !["generate", "edit"].includes(tool.id));
const toolIds = configurable.map(tool => tool.id);

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const rows = await prisma.studioToolConfig.findMany();
  const byId = new Map(rows.map(row => [row.toolId, row]));
  const providers = await prisma.modelProvider.findMany({ where: { isActive: true }, select: { name: true, displayName: true, kind: true, config: true, isPlanner: true, creditCost: true }, orderBy: { priority: "asc" } });
  const channels = { image: [], segment: [], split: [] };
  for (const p of providers) {
    const config = JSON.parse(p.config || "{}"), cap = channelCapability(p, config);
    if (channels[cap] && (cap !== "image" || supportsImageTask(config, "edit"))) channels[cap].push({ name: p.name, label: p.displayName, kind: p.kind });
  }
  return Response.json({
    tools: configurable.map(tool => ({
      id: tool.id,
      zh: tool.zh,
      en: tool.en,
      dependency: tool.dependency,
      preview: tool.preview,
      creditCost: tool.dependency === "vision" ? providers.find(p => p.isPlanner)?.creditCost ?? 1 : byId.get(tool.id)?.creditCost ?? tool.cost,
      isEnabled: byId.get(tool.id)?.isEnabled ?? true,
      routing: toolRouting(tool, byId.get(tool.id)),
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
      routing: z.object({ mode: z.enum(["inherit", "dedicated", "code", "language", "service"]), channelName: z.string().min(1).max(128).nullable(), segmentMode: z.enum(["default", "local", "dedicated"]), segmentChannelName: z.string().min(1).max(128).nullable() }).strict().optional(),
      reason: z.string().min(3).max(500),
    }).strict());
    if (input.creditCost === undefined && input.isEnabled === undefined && input.routing === undefined) throw new AppError("NO_CHANGES");
    const tool = configurable.find(item => item.id === input.toolId);
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "UPDATE_STUDIO_TOOL", input, async tx => {
      const previous = await tx.studioToolConfig.findUnique({ where: { toolId: input.toolId } });
      const routing = input.routing || toolRouting(tool, previous);
      const modes = tool.dependency === "image" ? ["inherit", "dedicated"] : [toolRouting(tool).mode];
      if (!modes.includes(routing.mode)) throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
      async function validateChannel(name, capability, required = true) {
        if (!name && !required) return;
        const row = name ? await tx.modelProvider.findUnique({ where: { name } }) : null;
        if (!row?.isActive || channelCapability(row) !== capability || capability === "image" && !supportsImageTask(JSON.parse(row.config || "{}"), "edit")) throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
      }
      if (routing.mode === "dedicated") await validateChannel(routing.channelName, tool.dependency, tool.dependency !== "split");
      else routing.channelName = null;
      if (tool.preview === "segment" && routing.segmentMode === "dedicated") await validateChannel(routing.segmentChannelName, "segment");
      else routing.segmentChannelName = null;
      const creditCost = input.creditCost ?? previous?.creditCost ?? tool.cost;
      const row = await tx.studioToolConfig.upsert({
        where: { toolId: input.toolId },
        create: { toolId: input.toolId, creditCost, isEnabled: input.isEnabled ?? true, routing },
        update: { creditCost, isEnabled: input.isEnabled, routing },
      });
      return {
        response: { toolId: row.toolId, creditCost: row.creditCost, isEnabled: row.isEnabled, routing: row.routing },
        audit: { toolId: row.toolId, before: previous ? { creditCost: previous.creditCost, isEnabled: previous.isEnabled, routing: previous.routing } : null, after: { creditCost: row.creditCost, isEnabled: row.isEnabled, routing: row.routing } },
      };
    }, prisma, "root");
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
