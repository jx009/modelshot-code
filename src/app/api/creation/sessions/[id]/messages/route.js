import { z } from "zod";
import { createAgentRun } from "@/lib/domain/creation/agent-runs";
import { agentRequestSchema } from "@/lib/creation/contracts/agent";
import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { readMessages } from "@/lib/domain/creation/projects";
import { createContentRun } from "@/lib/domain/creation/content-runs";
import { contentRunSchema } from "@/lib/creation/contracts/content-runs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { assertCreationAccess } from "@/lib/creation/access";

export async function GET(request, context) {
  try {
    const user = await requireUser({ resource: "session", id: (await context.params).id }), { id } = await context.params;
    const before = new URL(request.url).searchParams.get("before");
    return Response.json(await readMessages(user.id, id, before === null ? undefined : Number(before)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "session", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-message", user.id, 30, 600);
    const body = await readJson(request, z.union([agentRequestSchema, contentRunSchema]), 65536);
    assertCreationAccess(user.creationEnv, { kind: body.kind, runs: true });
    return Response.json(await (body.kind === "agent" ? createAgentRun : createContentRun)(user.id, id, body, request.headers.get("Idempotency-Key"), { env: user.creationEnv }), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
