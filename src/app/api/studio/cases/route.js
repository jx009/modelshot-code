import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { getCase } from "@/lib/commerce/catalog";
import { findInspiration } from "@/lib/server/inspiration";
import { caseRecipe } from "@/lib/commerce/case-recipe";
import { createImage } from "@/lib/domain/assets/service";
import { saveDocument } from "@/lib/domain/studio/documents";
import { scaleToFit } from "@/lib/studio/canvas-utils";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
const input = z.object({ caseId: z.string().max(80), locale: z.enum(["zh", "en"]).default("zh"), createKey: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/) }).strict();
export async function POST(request) {
  try {
    const user = await requireUser(), data = await readJson(request, input);
    await rateLimit("case-recipe", user.id, 30, 600);
    const item = await findInspiration(data.caseId) || getCase(data.caseId);
    if (!item) throw new AppError("CASE_NOT_FOUND", 404);
    const recipe = caseRecipe(item, data.locale);
    const id = createHash("sha256").update(`case:${user.id}:${item.id}:${data.createKey}`).digest("hex");
    let layers = [];
    if (!item.cover) {
      const asset = await createImage(user.id, await readFile(path.join(process.cwd(), "public", "inspiration", `${item.image}.webp`)), { id });
      const layer = { id: `reference_${item.id}`, type: "image", assetId: asset.id, name: data.locale === "zh" ? item.title : item.en, x: 90, y: 100, ...scaleToFit(asset.width, asset.height, 480), pixelWidth: asset.width, pixelHeight: asset.height, visible: true, rotation: 0, opacity: 1 };
      layers = [layer];
    }
    const doc = await saveDocument(user.id, { createKey: data.createKey, name: data.locale === "zh" ? item.title : item.titleEn || item.en || item.title, nameSource: "manual", content: { schemaVersion: 1, layers, messages: [], jobs: [], composer: { text: recipe.prompt, fixedPrompt: recipe.fixedPrompt, size: recipe.size, outputCount: recipe.outputCount, referenceIds: layers.map(l => l.id) } } });
    return Response.json({ documentId: doc.id, mode: recipe.mode });
  } catch (error) { return errorResponse(error); }
}
