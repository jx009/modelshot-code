import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { readPreset } from "../../../lib/domain/assets/service.js";

/**
 * 预设列表（公开接口，生图页选择器用）
 * GET /api/presets?type=models|scenes
 * 只返回上架中（isActive）的预设，无敏感字段
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "models";

    if (type === "scenes") {
      const scenes = await prisma.scenePreset.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, nameEn: true, category: true, referenceImage: true,
          promptSnippet: true, sortOrder: true,
        },
        orderBy: { sortOrder: "asc" },
      });
      return NextResponse.json(scenes);
    }

    const models = await prisma.modelPreset.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, nameEn: true, gender: true, ethnicity: true,
        bodyType: true, referenceImage: true, sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    });
    const usable = await Promise.all(models.map(async model => { try { await readPreset(model.referenceImage); return model; } catch { return null; } }));
    return NextResponse.json(usable.filter(Boolean));
  } catch (error) {
    console.error("[PRESETS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
