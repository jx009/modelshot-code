import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { digestJson } from "../generation/contracts.js";
import { lockUser, reserveCreditLots } from "../billing/ledger.js";
import { finishOutput } from "../generation/execution.js";

// Synchronous language calls share the existing reservation ledger. Recovery
// releases an expired call without reissuing a potentially paid upstream request.
export async function languageCall(userId, purpose, input, key, config, invoke, db = prisma) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  if (!config.visionApiKey || !config.chatModel) throw new AppError("VISION_NOT_CONFIGURED", 503);
  const requestId = createHash("sha256").update(`language:${userId}:${purpose}:${key}`).digest("hex");
  const digest = digestJson(input), cost = config.plannerCreditCost ?? 1;
  const admitted = await db.$transaction(async tx => {
    const user = await lockUser(tx, userId);
    const old = await tx.tryOn.findUnique({ where: { requestId } });
    if (old) {
      if (old.snapshot.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      if (old.status === "succeeded") return { result: old.resultData, replay: true };
      throw new AppError(old.errorCode || "REQUEST_IN_PROGRESS", 409);
    }
    const output = await tx.tryOn.create({ data: {
      id: randomUUID(), userId, requestId, personImage: "", clothesImage: "", prompt: purpose,
      provider: config.plannerProvider || "language-env", creditCost: cost, billingType: "credits", status: "running", fence: 1,
      leaseUntil: new Date(Date.now() + 120000),
      snapshot: { kind: "language", purpose, digest, model: config.chatModel, price: cost },
    } });
    if (cost) {
      const allocations = await reserveCreditLots(tx, user, cost);
      await tx.creditReservation.create({ data: { userId, tryOnId: output.id, channel: "credits", amount: cost, allocations } });
    }
    await tx.generationAttempt.create({ data: { tryOnId: output.id, fence: 1, provider: output.provider, state: "submitted" } });
    return { output };
  });
  if (admitted.replay) return admitted.result;
  try {
    const result = { ...await invoke(), languageCost: cost };
    if (!await finishOutput(admitted.output.id, 1, { resultData: result }, db)) throw new AppError("REQUEST_EXPIRED", 409);
    return result;
  } catch (error) {
    await finishOutput(admitted.output.id, 1, { errorCode: error instanceof AppError ? error.code : "LANGUAGE_CALL_FAILED" }, db);
    throw error;
  }
}

export async function recoverLanguageCall(id, db = prisma) {
  const row = await db.tryOn.findUnique({ where: { id } });
  if (row?.status === "running" && (!row.leaseUntil || row.leaseUntil <= new Date())) await finishOutput(id, row.fence, { errorCode: "LANGUAGE_CALL_EXPIRED" }, db);
}
