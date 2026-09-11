import { prisma } from "../prisma.js";
import { providerAdapter } from "../domain/generation/providers.js";

export function invalidateProviderConfig() {}

// Administrative diagnostics use the same explicit provider resolution as jobs.
export async function invokeModel({ provider, ...params }) {
  try {
    const row = await prisma.modelProvider.findUnique({ where: { name: provider } });
    if (!row?.isActive) return { success: false, error: "PROVIDER_UNAVAILABLE" };
    const stored = JSON.parse(row.config || "{}");
    const adapter = await providerAdapter({ snapshot: { provider, model: stored.model }, userId: null });
    const result = await adapter.generateTryOn(params);
    return { ...result, provider, success: true };
  } catch { return { success: false, error: "PROVIDER_DIAGNOSTIC_FAILED" }; }
}
