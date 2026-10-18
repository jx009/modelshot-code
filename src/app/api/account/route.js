import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { errorResponse } from "../../../lib/http.js";
import { usageSummary } from "../../../lib/domain/billing/ledger.js";
import { accountRecords } from "../../../lib/domain/billing/account-records.js";

export async function GET(request) {
  try {
    const user = await requireUser();
    const search = new URL(request.url).searchParams;
    const page = Math.max(1, Math.min(10000, Math.trunc(Number(search.get("page"))) || 1));
    const tab = ["orders", "usage"].includes(search.get("tab")) ? search.get("tab") : "all";
    const [usage, records] = await Promise.all([
      usageSummary(user.id),
      accountRecords(user.id, { page, tab }, prisma),
    ]);
    return Response.json({ usage, ...records }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
