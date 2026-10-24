CREATE TABLE "ArtifactExport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "exporterVersion" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "attemptLimit" INTEGER NOT NULL DEFAULT 3,
  "retryKey" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errorCode" TEXT,
  "blobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArtifactExport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ArtifactExport_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ArtifactRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ArtifactExport_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "CreationBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ArtifactExport_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT "ArtifactExport_attempt_check" CHECK ("attempt" >= 0)
);
CREATE UNIQUE INDEX "ArtifactExport_fingerprint_key" ON "ArtifactExport"("fingerprint");
CREATE INDEX "ArtifactExport_userId_status_idx" ON "ArtifactExport"("userId", "status");
CREATE INDEX "ArtifactExport_status_nextCheckAt_idx" ON "ArtifactExport"("status", "nextCheckAt");
CREATE INDEX "ArtifactExport_revisionId_idx" ON "ArtifactExport"("revisionId");
CREATE INDEX "ArtifactExport_blobId_idx" ON "ArtifactExport"("blobId");
