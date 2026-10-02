import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { submitStudioJob } from "@/lib/domain/studio/jobs";
import { studioConfig, capabilities } from "@/lib/domain/studio/providers";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { commerceReferences } from "@/lib/commerce/project";
import { digestJson } from "@/lib/domain/generation/contracts";
const input = z.object({ documentId: z.string().max(128), version: z.number().int().positive(), sectionIds: z.array(z.string().max(128)).min(1).max(10) }).strict();
export async function POST(request) {
  try {
    const user = await requireUser(), data = await readJson(request, input);
    await rateLimit("commerce-run", user.id, 40, 3600);
    const document = await prisma.studioDocument.findFirst({ where: { id: data.documentId, userId: user.id, deletedAt: null } });
    if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (document.version !== data.version) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    const commerce = document.content.commerce;
    if (!commerce?.productAssetId) throw new AppError("PRODUCT_IMAGE_REQUIRED");
    const target = document.content.layers.find(l => l.assetId === commerce.productAssetId && l.type === "image");
    if (!target) throw new AppError("TARGET_CHANGED", 409);
    const selected = [...new Set(data.sectionIds)].map(id => commerce.sections.find(s => s.id === id));
    if (selected.some(s => !s)) throw new AppError("INVALID_SECTION");
    const config = await studioConfig(undefined, commerce.provider, "image", "edit"), caps = await capabilities(undefined, config);
    const jobs = []; let failure = null;
    for (const section of selected) {
      try {
        const key = `commerce_${document.id}_${section.id}_${section.attempt}`;
        jobs.push(await submitStudioJob(user.id, { tool: "edit", ...(commerce.provider ? { provider: commerce.provider } : {}), documentId: document.id, documentVersion: document.version, targetId: target.id, assetId: commerce.productAssetId, referenceAssetIds: commerceReferences(commerce, section), sectionId: section.id, sectionAttempt: section.attempt, params: { prompt: section.prompt, size: commerce.size || "1024x1536" } }, key.length <= 128 ? key : `commerce_${digestJson(key)}`, prisma, { config, capabilities: caps }));
      } catch (error) { if (!(error instanceof AppError)) throw error; failure = error.code; break; }
    }
    // Persisted jobs remain discoverable by document + section even if this HTTP
    // response is lost. Retrying this request returns those exact jobs.
    return Response.json({ jobs, failure }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
