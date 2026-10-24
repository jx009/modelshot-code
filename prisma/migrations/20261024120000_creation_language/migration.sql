ALTER TABLE "TryOn" ADD COLUMN "executionQueue" TEXT NOT NULL DEFAULT 'generation';
ALTER TABLE "TryOn" ADD COLUMN "creationResultBlobId" TEXT;
CREATE UNIQUE INDEX "TryOn_creationResultBlobId_key" ON "TryOn"("creationResultBlobId");
CREATE INDEX "TryOn_executionQueue_status_nextAttemptAt_leaseUntil_idx" ON "TryOn"("executionQueue", "status", "nextAttemptAt", "leaseUntil");
ALTER TABLE "TryOn" ADD CONSTRAINT "TryOn_creationResultBlobId_fkey" FOREIGN KEY ("creationResultBlobId") REFERENCES "CreationBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
