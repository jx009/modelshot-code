import { z } from "zod";
import { createAgentRun } from "@/lib/domain/creation/agent-runs";
import { agentRequestSchema } from "@/lib/creation/contracts/agent";
import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { readMessages } from "@/lib/domain/creation/projects";
import { createContentRun } from "@/lib/domain/creation/content-runs";
import { contentRunSchema } from "@/lib/creation/contracts/content-runs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const before = new URL(request.url).searchParams.get("before");
    return Response.json(await readMessages(user.id, id, before === null ? undefined : Number(before)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-message", user.id, 30, 600);
    const body = await readJson(request, z.union([agentRequestSchema, contentRunSchema]), 65536);
    return Response.json(await (body.kind === "agent" ? createAgentRun : createContentRun)(user.id, id, body, request.headers.get("Idempotency-Key")), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
