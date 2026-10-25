import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { resumeRunSchema } from "@/lib/creation/contracts/runs";
import { resumeRun } from "@/lib/domain/creation/runs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "run", id: (await context.params).id, runs: true }), { id } = await context.params;
    await rateLimit("creation-resume", user.id, 30, 600);
    return Response.json(await resumeRun(user.id, id, await readJson(request, resumeRunSchema), undefined, { env: user.creationEnv }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
