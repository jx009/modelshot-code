import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";

/**
 * 预设管理（模特 + 场景）
 * GET    /api/admin/presets?type=models|scenes  → 列表
 * POST   /api/admin/presets                    → 新增
 * PATCH  /api/admin/presets                    → 更新 { id, ...fields }
 * DELETE /api/admin/presets?id=xxx&type=xxx    → 删除
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "models";

  if (type === "scenes") {
    const scenes = await prisma.scenePreset.findMany({
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
    });
    return NextResponse.json(scenes);
  }
  const models = await prisma.modelPreset.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
  });
  return NextResponse.json(models);
}

export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json();
    const { type } = body;
    if (!type) return new NextResponse("Missing type", { status: 400 });

    if (type === "scenes") {
      const { name, nameEn, category, promptSnippet, referenceImage, sortOrder } = body;
      if (!name || !category) return new NextResponse("name and category required", { status: 400 });
      const created = await prisma.scenePreset.create({
        data: { name, nameEn: nameEn || name, category, promptSnippet: promptSnippet || "", referenceImage: referenceImage || null, sortOrder: sortOrder ?? 99 },
      });
      return NextResponse.json(created);
    }

    const { name, nameEn, gender, ethnicity, bodyType, referenceImage, sortOrder } = body;
    if (!name || !gender || !ethnicity) return new NextResponse("name, gender, ethnicity required", { status: 400 });
    const created = await prisma.modelPreset.create({
      data: { name, nameEn: nameEn || name, gender, ethnicity, bodyType: bodyType || "standard", referenceImage: referenceImage || "", sortOrder: sortOrder ?? 99 },
    });
    return NextResponse.json(created);
  } catch (error) {
    console.error("[ADMIN_PRESETS_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function PATCH(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json();
    const { id, type } = body;
    if (!id || !type) return new NextResponse("Missing id or type", { status: 400 });

    if (type === "scenes") {
      const { name, nameEn, category, promptSnippet, referenceImage, isActive, sortOrder } = body;
      const updated = await prisma.scenePreset.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(nameEn !== undefined && { nameEn }),
          ...(category !== undefined && { category }),
          ...(promptSnippet !== undefined && { promptSnippet }),
          ...(referenceImage !== undefined && { referenceImage }),
          ...(isActive !== undefined && { isActive }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
      return NextResponse.json(updated);
    }

    const { name, nameEn, gender, ethnicity, bodyType, referenceImage, isActive, sortOrder } = body;
    const updated = await prisma.modelPreset.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nameEn !== undefined && { nameEn }),
        ...(gender !== undefined && { gender }),
        ...(ethnicity !== undefined && { ethnicity }),
        ...(bodyType !== undefined && { bodyType }),
        ...(referenceImage !== undefined && { referenceImage }),
        ...(isActive !== undefined && { isActive }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[ADMIN_PRESETS_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const type = searchParams.get("type");
    if (!id || !type) return new NextResponse("Missing id or type", { status: 400 });

    if (type === "scenes") {
      await prisma.scenePreset.delete({ where: { id } });
    } else {
      await prisma.modelPreset.delete({ where: { id } });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN_PRESETS_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
