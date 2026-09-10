import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "./auth";
import { prisma } from "./prisma";

/**
 * 四级角色层级（数值越高权限越大）
 * user=0 普通用户 | agent=1 流量手 | admin=2 管理员 | root=3 超级管理员
 * ROOT 专属：改 ADMIN/ROOT 角色、删除管理员、密钥主密钥轮换、全局佣金比例
 */
export const ROLE_LEVEL = { user: 0, agent: 1, admin: 2, root: 3 };

export function roleLevel(role) {
  return ROLE_LEVEL[role] ?? 0;
}

/**
 * Admin API 鉴权 — 所有 /api/admin/* 路由必须先调用
 * @param {Request} req
 * @param {string} minRole 最低角色级别（默认 "admin"；危险操作传 "root"）
 * @returns {{ user: {id, role} } | { response: Response }}
 */
export async function requireAdmin(req, minRole = "admin") {
  const session = await getServerSession(await buildAuthOptions());
  if (!session?.user?.id) {
    return { response: new Response("Unauthorized", { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, status: true },
  });
  // 封禁用户一律拒绝（即使曾是管理员）
  if (user?.status === "banned") {
    return { response: new Response("Forbidden", { status: 403 }) };
  }
  if (roleLevel(user?.role) < roleLevel(minRole)) {
    return { response: new Response("Forbidden", { status: 403 }) };
  }
  return { user };
}

/**
 * 管理操作审计 — 所有 admin 写操作调用（detail 含前后值；密钥内容除外）
 */
export async function auditLog(adminId, action, targetUserId, detail) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetUserId: targetUserId || null,
        detail: detail ? JSON.stringify(detail) : null,
      },
    });
  } catch (err) {
    // 审计失败不阻断业务，但要留下日志
    console.error("[AuditLog] failed:", err.message);
  }
}
