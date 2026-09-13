import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { buildPrompt, aspectRatioToSize } from "../../prompt-engine.js";
import { ownedAsset, assetUrl, readPreset } from "../assets/service.js";
import { resolveProvider } from "./providers.js";
import { ACTIVE, configurationSchema, digestJson, LIMITS, PROFILES, PROFILE_VERSION } from "./contracts.js";
import { buildWorkflowTasks, getWorkflow, workflowNeedsModel } from "./workflow-catalog.js";
import { activeCycle, CREDIT_PRICE, lockUser, PRICE_VERSION, usageSummary, reserveCreditLots } from "../billing/ledger.js";

export async function quoteGeneration(userId, input, db = prisma, dependencies = {}) {
  const config = configurationSchema.parse(input);
  if (config.projectId && !await db.project.findFirst({ where: { id: config.projectId, userId, archivedAt: null } })) throw new AppError("PROJECT_NOT_FOUND", 404);
  const provider = await (dependencies.resolveProvider || resolveProvider)(userId, config, db);
  const products = await Promise.all(config.images.map(id => ownedAsset(userId, id, db)));
  const referenceAssets = await Promise.all(config.referenceImages.map(async reference => ({
    role: reference.role,
    asset: await ownedAsset(userId, reference.id, db),
  })));
  const retryOutput = config.retryOfId ? await db.tryOn.findFirst({ where: { id: config.retryOfId, userId, status: { in: ["failed", "cancelled"] } } }) : null;
  if (config.retryOfId && !retryOutput) throw new AppError("RETRY_NOT_ALLOWED", 409);
  const workflow = getWorkflow(config.workflowId);
  const needsModel = retryOutput?.snapshot?.task ? retryOutput.snapshot.task.mode === "tryon" : workflowNeedsModel(workflow.id);
  const person = needsModel && config.personImage ? await ownedAsset(userId, config.personImage, db) : null;
  const model = needsModel && config.modelPresetId ? await db.modelPreset.findFirst({ where: { id: config.modelPresetId, isActive: true } }) : null;
  const scene = config.scenePresetId ? await db.scenePreset.findFirst({ where: { id: config.scenePresetId, isActive: true } }) : null;
  if (needsModel && !person && !model) throw new AppError("MODEL_REQUIRED");
  if (needsModel && config.modelPresetId && !model || config.scenePresetId && !scene) throw new AppError("PRESET_NOT_FOUND", 404);
  if (model && !person) await readPreset(model.referenceImage);
  if (scene?.referenceImage) await readPreset(scene.referenceImage);
  const prompt = needsModel
    ? await (dependencies.buildPrompt || buildPrompt)({ ...config, modelPreset: model, scenePreset: scene, userPrompt: config.prompt })
    : config.prompt.trim();
  const workflowTasks = buildWorkflowTasks(workflow.id, prompt, config);
  const tasks = retryOutput?.snapshot?.task
    ? [{ ...retryOutput.snapshot.task, prompt: retryOutput.snapshot.task.prompt || prompt }]
    : workflowTasks;
  const snapshotWorkflow = retryOutput?.snapshot?.workflow || { id: workflow.id, title: workflow.title };
  const deliveryFor = task => ({ ...PROFILES[task.aspectRatio || config.aspectRatio], fit: "contain", format: "png", version: PROFILE_VERSION });
  const snapshot = {
    version: 2, config, workflow: snapshotWorkflow, tasks, provider: provider.id, model: provider.model, capabilityVersion: provider.version,
    fallback: [], templateVersion: digestJson(tasks.map(task => task.prompt)), prompt,
    garments: products.map(asset => ({ id: asset.id, checksum: asset.checksum })),
    references: referenceAssets.map(({ role, asset }) => ({ id: asset.id, checksum: asset.checksum, role })),
    person: person ? { id: person.id, checksum: person.checksum } : null,
    modelPreset: model ? JSON.parse(JSON.stringify(model)) : null, scenePreset: scene ? JSON.parse(JSON.stringify(scene)) : null,
    nativeSize: provider.nativeSizes?.length ? aspectRatioToSize(tasks[0]?.aspectRatio || config.aspectRatio) : null,
    delivery: deliveryFor(tasks[0] || {}),
    qaPolicy: "optional",
  };
  const count = tasks.length * products.length * config.variants;
  const usage = await usageSummary(userId, db);
  const quotaCount = Math.min(count, usage.remaining);
  const creditCount = count - quotaCount;
  const pricing = { version: PRICE_VERSION, count, quotaCount, creditCount, credits: creditCount * CREDIT_PRICE, unitPrice: CREDIT_PRICE, channel: "platform", cycleId: usage.cycleId };
  const quote = await db.generationQuote.create({ data: { userId, digest: digestJson(snapshot), snapshot, pricing, expiresAt: new Date(Date.now() + 300_000) } });
  return { quoteId: quote.id, digest: quote.digest, expiresAt: quote.expiresAt, pricing, snapshot };
}

export async function submitGeneration(userId, quoteId, digest, idempotencyKey, db = prisma) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  return db.$transaction(async tx => {
    const user = await lockUser(tx, userId);
    const old = await tx.batchJob.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, include: { tryons: { select: { id: true } }, quote: true } });
    if (old) {
      if (old.quoteId !== quoteId || old.quote.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return submissionResult(old, old.tryons.map(row => row.id));
    }
    const quote = await tx.generationQuote.findFirst({ where: { id: quoteId, userId } });
    if (!quote || quote.digest !== digest) throw new AppError("QUOTE_NOT_FOUND", 404);
    if (quote.expiresAt <= new Date()) throw new AppError("QUOTE_EXPIRED", 409);
    if (await tx.batchJob.findUnique({ where: { quoteId } })) throw new AppError("QUOTE_ALREADY_USED", 409);
    const { snapshot, pricing } = quote;
    const { config } = snapshot;
    if (config.projectId && !await tx.project.findFirst({ where: { id: config.projectId, userId, archivedAt: null } })) throw new AppError("PROJECT_NOT_FOUND", 404);
    // Lock the shared queue admission boundary; Redis availability does not affect commit.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('queue-admission', 0))::text`;
    if (await tx.tryOn.count({ where: { status: { in: ACTIVE } } }) + pricing.count > LIMITS.queue) throw new AppError("QUEUE_FULL", 503, true);
    if (await tx.tryOn.count({ where: { userId, status: { in: ACTIVE } } }) + pricing.count > LIMITS.activePerUser) throw new AppError("USER_QUEUE_FULL", 429, true);
    for (const garment of snapshot.garments) await ownedAsset(userId, garment.id, tx);
    if (snapshot.person) await ownedAsset(userId, snapshot.person.id, tx);
    for (const reference of snapshot.references || []) await ownedAsset(userId, reference.id, tx);
    const cycle = await activeCycle(tx, userId, new Date(), true);
    const held = await tx.creditReservation.aggregate({ where: { userId, state: "held", channel: "credits" }, _sum: { amount: true } });
    if (pricing.quotaCount && (cycle.id !== pricing.cycleId || cycle.quota - cycle.used - cycle.reserved < pricing.quotaCount)) throw new AppError("QUOTE_STALE", 409, true);
    if (user.credits - (held._sum.amount || 0) < pricing.credits) throw new AppError("INSUFFICIENT_CREDITS", 402);
    const batch = await tx.batchJob.create({ data: { userId, quoteId, idempotencyKey, name: config.name || config.sku || "", totalCount: pricing.count, status: "queued", config: JSON.stringify(snapshot) } });
    const ids = [];
    const tasks = snapshot.tasks?.length ? snapshot.tasks : [{ id: "single", role: "hero", title: "Hero image", prompt: snapshot.prompt, workflowId: "single-shot" }];
    const planned = snapshot.garments.flatMap(garment => tasks.map(task => ({ garment, task })));
    for (let i = 0; i < pricing.count; i++) {
      const plannedOutput = planned[Math.floor(i / config.variants)];
      const garment = plannedOutput.garment;
      const task = plannedOutput.task;
      const channel = i < pricing.quotaCount ? "subscription" : "credits";
      const amount = channel === "subscription" ? 1 : CREDIT_PRICE;
      const aspectRatio = task.aspectRatio || config.aspectRatio;
      const outputSnapshot = {
        ...snapshot,
        garment,
        task,
        variant: i % config.variants,
        nativeSize: snapshot.nativeSize === null ? null : aspectRatioToSize(aspectRatio),
        delivery: { ...PROFILES[aspectRatio], fit: "contain", format: "png", version: PROFILE_VERSION },
      };
      const output = await tx.tryOn.create({ data: {
        id: randomUUID(), userId, batchJobId: batch.id, requestId: randomUUID(), status: "queued", snapshot: outputSnapshot,
        projectId: config.projectId || null, sku: config.sku,
        clothesImage: assetUrl(garment.id), personImage: snapshot.person ? assetUrl(snapshot.person.id) : snapshot.modelPreset?.referenceImage || "",
        prompt: task.prompt, aspectRatio, creditCost: channel === "credits" ? amount : 0, billingType: channel,
        modelPresetId: config.modelPresetId || null, scenePresetId: config.scenePresetId || null, platformSpec: config.platformSpec || null,
        provider: snapshot.provider, pose: config.pose, camera: config.camera, lighting: config.lighting, variantGroupId: batch.id, retryOfId: config.retryOfId || null,
      } });
      ids.push(output.id);
      const allocations = channel === "credits" ? await reserveCreditLots(tx, user, amount) : [];
      await tx.creditReservation.create({ data: { userId, tryOnId: output.id, channel, amount, allocations, cycleId: channel === "subscription" ? cycle.id : null } });
      const applicableRoles = new Set(task.references || []);
      const assetIds = [garment.id, snapshot.person?.id, ...(snapshot.references || []).filter(reference => applicableRoles.has(reference.role)).map(reference => reference.id)].filter(Boolean);
      for (const assetId of new Set(assetIds)) await tx.assetReference.create({ data: { assetId, entityId: output.id, kind: "generation_input" } });
      await tx.outboxEvent.create({ data: { businessKey: `generate:${output.id}:0`, kind: "generate", entityId: output.id } });
    }
    if (pricing.quotaCount) await tx.billingCycle.update({ where: { id: cycle.id }, data: { reserved: { increment: pricing.quotaCount } } });
    return submissionResult(batch, ids);
  }, { timeout: 30_000, maxWait: 30_000 });
}

function submissionResult(batch, ids) {
  return { batchJobId: batch.id, tryonId: ids[0], tryonIds: ids, variantGroupId: batch.id, variantCount: ids.length, count: ids.length, status: batch.status };
}
