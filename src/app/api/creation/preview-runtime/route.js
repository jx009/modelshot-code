import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse } from "@/lib/http";
import { publicationOrigin } from "@/lib/domain/creation/web-publications";

export async function GET(request) {
  try {
    await requireUser();
    const origin = publicationOrigin(), appOrigin = new URL(process.env.NEXTAUTH_URL || request.url).origin;
    if (origin === appOrigin || !process.env.NEXTAUTH_URL) throw new AppError("CREATION_PREVIEW_ORIGIN_REQUIRED", 503);
    return Response.json({ url: `${origin}/api/creation-preview`, appOrigin }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
