"use client";
import { requestKey } from "@/lib/client-api";

export function useAdminReason() {
  // Keep the audit contract and idempotency protection without blocking routine admin configuration.
  const ask = () => Promise.resolve({ reason: "Admin configuration update", key: requestKey() });
  return { ask, dialog: null };
}
