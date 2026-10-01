import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { capabilities } from "@/lib/domain/studio/providers";
export async function GET(request) {
  try {
    await requireUser();
    const query = new URL(request.url).searchParams;
    return Response.json(await capabilities(undefined, undefined, query.get("imageProvider") || undefined));
  }
  catch (error) { return errorResponse(error); }
}
