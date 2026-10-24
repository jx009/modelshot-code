import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { capabilities } from "@/lib/domain/studio/providers";
export async function GET(request) {
  const started = performance.now();
  let authorized = null;
  const finish = response => {
    const finished = performance.now(), authEnd = authorized ?? finished;
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Server-Timing", `auth;dur=${(authEnd - started).toFixed(1)}, catalogue;dur=${(finished - authEnd).toFixed(1)}, total;dur=${(finished - started).toFixed(1)}`);
    return response;
  };
  try {
    await requireUser();
    authorized = performance.now();
    const query = new URL(request.url).searchParams;
    const imageOnly = query.get("scope") === "images";
    const caps = await capabilities(undefined, undefined, query.get("imageProvider") || undefined, { imageOnly });
    const creationEnabled = process.env.CREATION_RUNS_ENABLED === "true" && process.env.CREATION_WORKSPACE_ENABLED === "true" && caps.planningAvailable;
    return finish(Response.json({ ...caps, creationTypes: {
      poster: Boolean(creationEnabled && process.env.CREATION_POSTER_ENABLED === "true"),
      slides: Boolean(creationEnabled && process.env.CREATION_SLIDES_ENABLED === "true"),
    }, ...(!imageOnly ? { creationRunsAvailable: process.env.CREATION_RUNS_ENABLED === "true" } : {}) }));
  }
  catch (error) { return finish(errorResponse(error)); }
}
