import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../../../lib/auth";
import { usageSummary } from "../../../lib/domain/billing/ledger.js";

/**
 * 当前用户用量摘要（pricing 页 / 个人中心展示）
 * GET /api/usage → { plan, planName, monthlyQuota, monthUsage, remaining, credits }
 */
export async function GET(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const summary = await usageSummary(session.user.id);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[USAGE_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
