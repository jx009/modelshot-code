import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { capabilities } from "@/lib/domain/studio/providers";
export async function GET() {
  try { await requireUser(); return Response.json(await capabilities()); }
  catch (error) { return errorResponse(error); }
}

