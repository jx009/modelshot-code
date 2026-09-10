import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

/**
 * 生成任务查询 — 生成流程已在服务端异步完成，直接读 DB 即可
 * GET  /api/tryons          → 用户全部记录
 * GET  /api/tryons?id=xxx   → 单条记录（前端轮询用）
 */
export async function GET(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const ids = searchParams.get("ids")
      ?.split(",")
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 50);

    if (id) {
      const tryon = await prisma.tryOn.findFirst({
        where: { id, userId: session.user.id }
      });
      if (!tryon) {
        return new NextResponse("Not Found", { status: 404 });
      }
      return NextResponse.json(tryon);
    }

    if (ids?.length) {
      const tryons = await prisma.tryOn.findMany({
        where: { id: { in: ids }, userId: session.user.id },
      });
      const byId = new Map(tryons.map(tryon => [tryon.id, tryon]));
      return NextResponse.json(ids.map(tryonId => byId.get(tryonId)).filter(Boolean));
    }

    // 惰性清理超时僵尸记录（批处理进程被回收的兜底）
    const { sweepStaleTryOns } = await import("../../../lib/generation.js");
    await sweepStaleTryOns(session.user.id).catch(() => {});

    const tryons = await prisma.tryOn.findMany({
      where: { userId: session.user.id },
      orderBy: { createTime: "desc" }
    });

    return NextResponse.json(tryons);
  } catch (error) {
    console.error("[TRYONS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return new NextResponse("Missing try-on ID", { status: 400 });
    }

    const tryon = await prisma.tryOn.findFirst({
      where: { id, userId: session.user.id }
    });

    if (!tryon) {
      return new NextResponse("Not Found", { status: 404 });
    }

    await prisma.tryOn.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[TRYONS_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
