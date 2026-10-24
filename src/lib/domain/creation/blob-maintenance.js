// Shared by every artifact codec. Claim before storage I/O so a new revision
// cannot publish an expired staging object while it is being removed.
export async function cleanupExpiredCreationBlobs({ db, store, now = new Date(), limit = 25, shouldStop = () => false }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isFinite(+now)) throw new Error("INVALID_CREATION_CLEANUP_OPTIONS");
  const unused = { revisions: { none: {} }, outputs: { none: {} }, exports: { none: {} }, imports: { none: {} } };
  const due = { state: { in: ["staging", "deleting"] }, expiresAt: { lt: now }, ...unused };
  const rows = await db.creationBlob.findMany({ where: due, take: limit, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], select: { id: true, objectKey: true } });
  const result = { scanned: rows.length, deleted: 0, failed: 0 };
  for (const row of rows) {
    if (shouldStop()) break;
    // expiresAt doubles as a short maintenance lease for deleting objects.
    // Two workers reading the same due batch cannot both claim it. A crash
    // after object removal is retried by the idempotent storage delete later.
    const lease = new Date(+now + 5 * 60000);
    const claimed = await db.creationBlob.updateMany({ where: { id: row.id, ...due }, data: { state: "deleting", expiresAt: lease } });
    if (!claimed.count) continue;
    try {
      await store.delete(row.objectKey);
      const removed = await db.creationBlob.deleteMany({ where: { id: row.id, state: "deleting", expiresAt: lease, ...unused } });
      result.deleted += removed.count;
    } catch {
      // Keep the deleting row and lease. One unavailable object must not starve
      // other expired blobs or be retried on every scheduler heartbeat.
      result.failed++;
    }
  }
  return result;
}
