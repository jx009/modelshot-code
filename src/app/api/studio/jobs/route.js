import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { jobSchema } from "@/lib/studio/tools";
import { submitStudioJob, presentJob } from "@/lib/domain/studio/jobs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
export async function POST(request) {
  try {
    const user = await requireUser();
    await rateLimit("studio-jobs", user.id, 60, 600);
    return Response.json(await submitStudioJob(user.id, await readJson(request, jobSchema), request.headers.get("Idempotency-Key")), { status: 202 });
  } catch (error) { return errorResponse(error); }
}
export async function GET(request) {
  try {
    const user = await requireUser();
    const documentId = new URL(request.url).searchParams.get("documentId");
    const jobs = await prisma.tryOn.findMany({ where: { userId: user.id, AND: [{ snapshot: { path: ["kind"], equals: "studio" } }, ...(documentId ? [{ snapshot: { path: ["documentId"], equals: documentId } }] : [])] }, orderBy: { createTime: "desc" }, take: 100 });
    return Response.json(jobs.map(presentJob));
  } catch (error) { return errorResponse(error); }
}

