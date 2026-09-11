import { CATALOG, CATALOG_VERSION } from "../../../lib/domain/billing/catalog.js";
export async function GET() {
  return Response.json({ version: CATALOG_VERSION, products: Object.values(CATALOG), paymentsEnabled: process.env.PAYMENTS_ENABLED === "1" });
}
