import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getSiteConfigView, setSiteConfig, invalidateSiteConfig } from "@/lib/site-config";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { getCreditPackages, packagesSchema, validateGateway } from "@/lib/domain/billing/recharge-config";
import { readJson, errorResponse } from "@/lib/http";

const configSchema = z.object({
  payments_enabled: z.enum(["true", "false"]), epay_enabled: z.enum(["true", "false"]),
  epay_gateway: z.string().trim().max(500), epay_merchant_id: z.string().trim().max(100),
  epay_merchant_key: z.string().trim().max(500).optional(),
  epay_methods: z.array(z.enum(["alipay", "wxpay", "qqpay"])).min(1).max(3),
  payment_public_url: z.string().trim().max(500),
}).strict();

export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    const [packages, configs] = await Promise.all([getCreditPackages(), getSiteConfigView()]);
    return Response.json({ packages, configs: configs.filter(c => c.key.startsWith("epay_") || ["payments_enabled", "payment_public_url"].includes(c.key)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

export async function PATCH(req) {
  const auth = await requireAdmin(req, "root");
  if (auth.response) return auth.response;
  try {
    const input = await readJson(req, z.object({ packages: packagesSchema, config: configSchema, reason: z.string().trim().min(3).max(500) }).strict());
    for (const key of ["epay_gateway", "payment_public_url"]) if (input.config[key]) input.config[key] = validateGateway(input.config[key]);
    const result = await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "UPDATE_RECHARGE", input, async tx => {
      await setSiteConfig("credit_packages", JSON.stringify(input.packages), tx);
      for (const [key, value] of Object.entries(input.config)) {
        if (key === "epay_merchant_key" && !value) continue; // Blank secrets preserve the configured key.
        await setSiteConfig(key, Array.isArray(value) ? [...new Set(value)].join(",") : value, tx);
      }
      return { audit: { packageIds: input.packages.map(p => p.id), changedKeys: Object.keys(input.config), enabled: input.config.payments_enabled } };
    }, prisma, "root");
    invalidateSiteConfig();
    return Response.json(result);
  } catch (e) { return errorResponse(e); }
}
