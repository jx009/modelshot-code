import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin, auditLog, ROLE_LEVEL } from "../../../../lib/admin-auth";
import { UserService } from "../../../../lib/services/user";

const VALID_ROLES = ["user", "agent", "admin", "root"];
const VALID_STATUS = ["active", "banned"];

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
    const { id, role, creditsDelta, status, plan } = await req.json();
    if (!id) return new NextResponse("Missing user id", { status: 400 });

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, credits: true, email: true } });
    if (!target) return new NextResponse("User not found", { status: 404 });

    const adminLevel = ROLE_LEVEL[auth.user.role] ?? 0;
    const targetLevel = ROLE_LEVEL[target.role] ?? 0;

    // ── 角色变更：仅 ROOT；不许操作自己（防锁死）；不许降级同级或更高（除非 root 操作自己以外——root 不能动 root，含自己）──
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return new NextResponse("Invalid role", { status: 400 });
      if (adminLevel < ROLE_LEVEL.root) {
        return new NextResponse("Only ROOT can change roles", { status: 403 });
      }
      if (id === auth.user.id) {
        return new NextResponse("Cannot change your own role", { status: 400 });
      }
      if (targetLevel >= ROLE_LEVEL.root) {
        return new NextResponse("Cannot modify another ROOT", { status: 403 });
      }
    }

    // ── 封禁：admin 可封 user/agent；不能封 admin+；不能封自己 ──
    if (status !== undefined) {
      if (!VALID_STATUS.includes(status)) return new NextResponse("Invalid status", { status: 400 });
      if (id === auth.user.id) {
        return new NextResponse("Cannot ban yourself", { status: 400 });
      }
      if (targetLevel >= ROLE_LEVEL.admin) {
        return new NextResponse("Cannot ban admin/root", { status: 403 });
      }
    }

    if (plan && !["free", "standard", "pro"].includes(plan)) {
      return new NextResponse("Invalid plan", { status: 400 });
    }

    // ── 调积分：走流水（grant），审计含前后值 ──
    if (typeof creditsDelta === "number" && creditsDelta !== 0) {
      if (creditsDelta > 0) {
        await UserService.addCredits(id, creditsDelta, { type: "grant", reason: `Admin grant by ${auth.user.id}` });
      } else {
        await UserService.deductCredits(id, Math.abs(creditsDelta)).catch(() => {
          throw new Error("Insufficient credits to deduct");
        });
      }
      await auditLog(auth.user.id, "GRANT_CREDITS", id, { before: target.credits, delta: creditsDelta });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(role !== undefined && { role }),
        ...(status !== undefined && { status }),
        ...(plan && plan !== "free" && { plan, planExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) }),
        ...(plan === "free" && { plan, planExpiresAt: null }),
      },
      select: { id: true, name: true, email: true, credits: true, role: true, status: true, plan: true },
    });

    if (role !== undefined && role !== target.role) {
      await auditLog(auth.user.id, "SET_ROLE", id, { before: target.role, after: role });
    }
    if (status !== undefined && status !== target.status) {
      await auditLog(auth.user.id, status === "banned" ? "BAN_USER" : "UNBAN_USER", id, { before: target.status, after: status });
    }
    if (plan) {
      await auditLog(auth.user.id, "SET_PLAN", id, { plan });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[ADMIN_USERS_PATCH]", error);
    return new NextResponse(error.message || "Internal Error", { status: 500 });
  }
}
