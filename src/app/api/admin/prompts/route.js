import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";
import { invalidatePromptCache } from "../../../../lib/prompt-template-store";

/**
 * Prompt 模板管理
 * GET   /api/admin/prompts          → 列表
 * POST  /api/admin/prompts          → 新增 { name, category, template }
 * PATCH /api/admin/prompts          → 更新 { id, name?, template?, isActive? }（更新后清缓存，立即生效）
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  const templates = await prisma.promptTemplate.findMany({
    orderBy: [{ isActive: "desc" }, { category: "asc" }],
  });
  return NextResponse.json(templates);
}

export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { name, category, template } = await req.json();
    if (!name || !category || !template) {
      return new NextResponse("name, category, template required", { status: 400 });
    }
    const created = await prisma.promptTemplate.create({ data: { name, category, template } });
    invalidatePromptCache();
    return NextResponse.json(created);
  } catch (error) {
    console.error("[ADMIN_PROMPTS_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function PATCH(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { id, name, template, isActive } = await req.json();
    if (!id) return new NextResponse("Missing id", { status: 400 });

    const updated = await prisma.promptTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(template !== undefined && { template }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    invalidatePromptCache(); // 立即生效
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[ADMIN_PROMPTS_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
