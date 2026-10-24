// Leave room for the save key/revision envelope under the 256 KiB route limit.
export const MAX_OPERATION_BATCH_BYTES = 240 * 1024;
const MAX_PENDING_BYTES = 1024 * 1024;
const sizes = new WeakMap();
const encoder = new TextEncoder();
export function layoutOperationBytes(operation) {
  let bytes = sizes.get(operation);
  if (bytes === undefined) { bytes = encoder.encode(JSON.stringify(operation)).byteLength; sizes.set(operation, bytes); }
  return bytes;
}

export function assertLayoutJournalCapacity(pending, additions) {
  if (pending.length + additions.length > 1000) throw new Error("PENDING_EDIT_LIMIT");
  let bytes = 2;
  for (const operation of [...pending, ...additions]) {
    const size = layoutOperationBytes(operation);
    if (size + 2 > MAX_OPERATION_BATCH_BYTES) throw new Error("LAYOUT_OPERATION_TOO_LARGE");
    bytes += size + 1;
  }
  if (bytes > MAX_PENDING_BYTES) throw new Error("PENDING_EDIT_LIMIT");
}

export function nextLayoutOperationBatch(operations) {
  const batch = [];
  let bytes = 2;
  for (const operation of operations) {
    const size = layoutOperationBytes(operation);
    if (size + 2 > MAX_OPERATION_BATCH_BYTES) throw new Error("LAYOUT_OPERATION_TOO_LARGE");
    const separator = batch.length ? 1 : 0;
    if (batch.length === 100 || bytes + size + separator > MAX_OPERATION_BATCH_BYTES) break;
    batch.push(operation); bytes += size + separator;
  }
  return batch;
}
