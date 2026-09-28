import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import { ROLE_LEVEL } from "@/lib/admin-auth";

/**
 * Admin 布局 — 服务端鉴权守卫（层级校验：admin 及以上可进，agent/user 一律踢回首页）
 */
export default async function AdminLayout({ children }) {
  await connection();
  const session = await getServerSession(await buildAuthOptions());
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (user?.status === "banned") redirect("/");
  if ((ROLE_LEVEL[user?.role] ?? 0) < ROLE_LEVEL.admin) redirect("/");

  return (
    <div data-admin-shell className="h-dvh min-h-0 w-full overflow-hidden bg-bg-page text-primary-text flex">
      {/* 侧边栏 */}
      <aside data-admin-sidebar className="relative z-20 w-56 min-h-0 border-r border-divider bg-bg-card/50 flex-shrink-0 hidden md:flex flex-col">
        <div className="p-5 border-b border-divider flex-shrink-0">
          <div className="text-sm font-black uppercase tracking-wider text-primary">ModelShot</div>
          <div className="text-[10px] text-secondary-text font-bold mt-0.5">Admin Console</div>
        </div>
        <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <AdminNav />
        </div>
        <div className="p-4 border-t border-divider flex-shrink-0">
          <Link href="/" className="text-[11px] text-secondary-text hover:text-primary-text transition-colors">
            ← Back to App
          </Link>
        </div>
      </aside>
      {/* 主内容 */}
      <main data-admin-content className="relative z-0 flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain">
        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          <AdminNav mobile />
          {children}
        </div>
      </main>
    </div>
  );
}
