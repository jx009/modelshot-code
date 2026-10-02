import { z } from "zod";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { briefSchema, commerceSchema } from "@/lib/commerce/schema";
import { agentInstruction, applyDecision, reviewInstruction, reviewSchema } from "@/lib/commerce/agent";
import { commerceContent } from "@/lib/commerce/project";
import { readOwnedImage, ownedAsset } from "@/lib/domain/assets/service";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { studioConfig, vision } from "@/lib/domain/studio/providers";
import { languageCall } from "@/lib/domain/studio/language";
import { saveDocument } from "@/lib/domain/studio/documents";
import { presentJob } from "@/lib/domain/studio/jobs";
import { digestJson } from "@/lib/domain/generation/contracts";

const input = z.object({
  documentId: z.string().max(128).optional(), version: z.number().int().positive().optional(),
  brief: briefSchema, productAssetId: z.string().max(128), referenceAssetId: z.string().max(128).optional(),
  provider: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(), size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1536"),
  message: z.string().trim().min(1).max(2400), targetSectionId: z.string().max(128).optional(), reviewJobId: z.string().max(128).optional(),
}).strict();

export async function POST(request) {
  try {
    const user = await requireUser(), data = await readJson(request, input);
    const key = request.headers.get("idempotency-key"), digest = digestJson(data);
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
    let document = data.documentId ? await prisma.studioDocument.findFirst({ where: { id: data.documentId, userId: user.id, deletedAt: null } }) : await prisma.studioDocument.findUnique({ where: { userId_createKey: { userId: user.id, createKey: key } } });
    if (document?.deletedAt || data.documentId && !document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (document?.content.commerce?.agent?.lastTurn === key) {
      if (document.content.commerce.agent.lastTurnDigest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return Response.json({ document, replayed: true });
    }
    if (document && document.version !== data.version) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    if (document && !document.content.commerce) throw new AppError("NOT_COMMERCE_PROJECT");
    await rateLimit("commerce-plan", user.id, 30, 3600);
    const commerce = commerceSchema.parse({ version: 1, sections: [], ...document?.content.commerce, brief: data.brief, productAssetId: data.productAssetId, referenceAssetId: data.referenceAssetId, provider: data.provider, size: data.size, planning: "agent" });
    // A project's identity references stay fixed once planning starts. New
    // products belong in a new project; prompt revisions keep previous outputs.
    if (document && (document.content.commerce.productAssetId !== data.productAssetId || document.content.commerce.referenceAssetId !== data.referenceAssetId)) throw new AppError("COMMERCE_SOURCE_CHANGED", 409);
    const product = await ownedAsset(user.id, data.productAssetId);
    const reference = data.referenceAssetId ? await ownedAsset(user.id, data.referenceAssetId) : null;
    const resize = async id => sharp(await readOwnedImage(user.id, id)).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const rows = document ? await prisma.tryOn.findMany({ where: { userId: user.id, snapshot: { path: ["documentId"], equals: document.id } }, orderBy: { createTime: "desc" }, take: 100 }) : [];
    const jobs = rows.filter(r => r.snapshot.kind === "studio").map(presentJob);
    const reviewJob = data.reviewJobId ? jobs.find(j => j.id === data.reviewJobId && j.status === "succeeded" && j.sectionId && j.resultData?.assets?.[0]) : null;
    if (data.reviewJobId && !reviewJob) throw new AppError("JOB_NOT_FOUND", 404);
    const config = await studioConfig();
    const result = await languageCall(user.id, "commerce-agent", data, key, config, async () => {
      const image = await resize(data.productAssetId);
      const history = (document?.content.messages || []).slice(-8);
      if (reviewJob) {
        const card = commerce.sections.find(s => s.id === reviewJob.sectionId);
        if (!card || card.attempt !== (reviewJob.sectionAttempt || 0)) throw new AppError("STORYBOARD_CHANGED", 409);
        const review = reviewSchema.parse(JSON.parse(await vision(config, { image, references: [await resize(reviewJob.resultData.assets[0].id)], instruction: reviewInstruction, imageContext: JSON.stringify({ language: commerce.brief.language, card, styleLock: commerce.agent?.styleLock, roles: ["original product", "generated result to review"] }), json: true, maxTokens: 2200, signal: AbortSignal.timeout(80000) })));
        if (review.verdict === "revise" && !review.revision.trim()) throw new AppError("INVALID_AGENT_PLAN", 502);
        return { review, message: [review.summary, ...review.issues, review.revision].filter(Boolean).join("\n"), sections: commerce.sections, changed: [] };
      }
      const text = await vision(config, { image, references: reference ? [await resize(reference.id)] : [], instruction: agentInstruction, imageContext: JSON.stringify({ brief: commerce.brief, currentSections: commerce.sections, retiredIds: commerce.agent?.retiredIds || [], styleLock: commerce.agent?.styleLock, history, request: data.message, targetSectionId: data.targetSectionId, imageRoles: ["original product identity", "optional style reference only"] }), json: true, maxTokens: 7000, signal: AbortSignal.timeout(80000) });
      const previousAssets = Object.fromEntries(commerce.sections.map(s => [s.id, jobs.find(j => j.sectionId === s.id && (j.sectionAttempt || 0) === s.attempt && j.status === "succeeded")?.resultData?.assets?.[0]?.id]));
      try {
        const applied = applyDecision(JSON.parse(text), commerce, { targetSectionId: data.targetSectionId, previousAssets });
        return { ...applied, message: [applied.decision.message, ...applied.decision.questions].join("\n") };
      } catch { throw new AppError("INVALID_AGENT_PLAN", 502); }
    });
    const agent = { retiredIds: [...new Set([...(commerce.agent?.retiredIds || []), ...(result.decision?.removeIds || [])])], summary: result.decision?.message || commerce.agent?.summary || "", styleLock: result.decision?.styleLock || commerce.agent?.styleLock || "", evidence: result.decision?.evidence || commerce.agent?.evidence || [], questions: result.decision?.questions || [], lastTurn: key, lastTurnDigest: digest };
    const content = commerceContent(document?.content, { ...commerce, sections: result.sections, agent }, [product, reference].filter(Boolean).map(a => ({ assetId: a.id, width: a.width, height: a.height })), jobs);
    content.messages = [...content.messages, { id: digestJson({ key, role: "user" }), role: "user", text: data.message }, { id: digestJson({ key, role: "assistant" }), role: "assistant", text: result.message }];
    const saved = await saveDocument(user.id, { ...(document ? { id: document.id, version: document.version } : { createKey: key }), name: document?.name || data.message.slice(0, 100), nameSource: document?.nameSource || "prompt", content });
    return Response.json({ document: saved, changed: result.changed, review: result.review, languageCost: result.languageCost });
  } catch (error) { return errorResponse(error); }
}
