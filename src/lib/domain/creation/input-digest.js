import { digestJson } from "../generation/contracts.js";

// An empty reference list must hash like requests persisted before attachments
// existed. Nonempty lists remain part of the idempotency identity.
export function creationInputDigest(input) {
  return digestJson({ ...input, referenceIds: input.referenceIds?.length ? input.referenceIds : undefined });
}
