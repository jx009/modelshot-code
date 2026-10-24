import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { resumeRunSchema } from "@/lib/creation/contracts/runs";
import { resumeRun } from "@/lib/domain/creation/runs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-resume", user.id, 30, 600);
    return Response.json(await resumeRun(user.id, id, await readJson(request, resumeRunSchema)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
