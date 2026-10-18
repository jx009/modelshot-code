import { z } from "zod";
import { getSiteConfig } from "../../site-config.js";

const credits = z.number().int().min(0).max(100000);
export const resolutionPricingSchema = z.object({ "1K": credits, "2K": credits, "4K": credits }).strict();
export const DEFAULT_RESOLUTION_SURCHARGES = Object.freeze({ "1K": 0, "2K": 0, "4K": 0 });

export async function getResolutionSurcharges(db) {
  const raw = await getSiteConfig("image_resolution_pricing", db);
  return raw ? resolutionPricingSchema.parse(JSON.parse(raw)) : { ...DEFAULT_RESOLUTION_SURCHARGES };
}
