import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";





/**
 * 用户管理
 * GET   /api/admin/users?page=&q=&role=&status=&sort=  → 搜索/筛选/排序/分页 + 用量统计
 * PATCH /api/admin/users { id, role?, creditsDelta?, status?, plan? }  → 全部写审计；角色/封禁有 ROOT 边界
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = 20;
    const q = searchParams.get("q")?.trim();
    const role = searchParams.get("role")?.trim();
    const status = searchParams.get("status")?.trim();
    const sort = searchParams.get("sort") || "newest";

    const where = {
      ...(q && { OR: [{ name: { contains: q } }, { email: { contains: q } }] }),
      ...(role && { role }),
      ...(status && { status }),
    };

    // User 模型无注册时间字段，newest 用 id 排序（cuid 内含时间序）
    const orderBy = {
      newest: { id: "desc" },
      credits: { credits: "desc" },
      tryons: { tryons: { _count: "desc" } },
    }[sort] || { id: "desc" };

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // 先查用户，再按 userId 聚合月用量（Prisma 嵌套 select 不支持 _sum 聚合）
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, image: true,
        credits: true, role: true, status: true, plan: true,
        passwordHash: true,
        _count: { select: { tryons: true } },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    });
    const [total, usageRows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.creditTransaction.groupBy({
        by: ["userId"],
        where: {
          type: "consume", channel: "subscription",
          createdAt: { gte: monthStart },
          userId: { in: users.map(u => u.id) },
        },
        _sum: { amount: true },
      }),
    ]);
    const usageMap = Object.fromEntries(usageRows.map(r => [r.userId, Math.abs(r._sum.amount || 0)]));

    return NextResponse.json({
      users: users.map(u => ({
        ...u,
        passwordHash: undefined, // 永不回传 hash；只回是否设置过
        hasPassword: Boolean(u.passwordHash),
        tryonCount: u._count.tryons,
        _count: undefined,
        monthUsage: usageMap[u.id] || 0,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("[ADMIN_USERS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function PATCH(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    const { administerUser, adminUserSchema } = await import("../../../../lib/domain/identity/administration.js");
    const { readJson } = await import("../../../../lib/http.js");
    const input = await readJson(req, adminUserSchema);
    return NextResponse.json(await administerUser(auth.user.id, input, req.headers.get("idempotency-key")));
  } catch (error) {
    const { errorResponse } = await import("../../../../lib/http.js");
    return errorResponse(error);
  }
}
