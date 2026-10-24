CREATE TABLE "CreationImport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "importKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "sourceBlobId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errorCode" TEXT,
  "artifactId" TEXT,
  "report" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreationImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CreationImport_sourceBlobId_fkey" FOREIGN KEY ("sourceBlobId") REFERENCES "CreationBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CreationImport_projectId_importKey_key" ON "CreationImport"("projectId", "importKey");
CREATE INDEX "CreationImport_userId_status_idx" ON "CreationImport"("userId", "status");
CREATE INDEX "CreationImport_status_nextCheckAt_idx" ON "CreationImport"("status", "nextCheckAt");
CREATE INDEX "CreationImport_sourceBlobId_idx" ON "CreationImport"("sourceBlobId");
