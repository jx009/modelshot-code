import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse } from "@/lib/http";
import { readRun } from "@/lib/domain/creation/runs";
import { createRunStream } from "@/lib/domain/creation/event-stream";

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const raw = request.headers.get("Last-Event-ID") || new URL(request.url).searchParams.get("after") || "0";
    if (!/^\d{1,10}$/.test(raw) || Number(raw) > 2147483647) throw new AppError("INVALID_EVENT_CURSOR");
    await readRun(user.id, id);
    return new Response(createRunStream(user.id, id, Number(raw), request.signal), {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" },
    });
  } catch (error) { return errorResponse(error); }
}
