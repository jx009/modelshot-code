CREATE TABLE "CreationProject" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "createKey" TEXT NOT NULL, "name" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "coverAssetId" TEXT, "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreationProject_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreationSession" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL, "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreationSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreationMessage" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "clientKey" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
  "role" TEXT NOT NULL, "text" TEXT NOT NULL, "references" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CreationMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreationArtifact" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "createKey" TEXT NOT NULL, "name" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 1, "schemaVersion" INTEGER NOT NULL DEFAULT 1, "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreationArtifact_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreationBlob" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "objectKey" TEXT NOT NULL, "checksum" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL, "state" TEXT NOT NULL DEFAULT 'staging', "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CreationBlob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ArtifactRevision" (
  "id" TEXT NOT NULL, "artifactId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "baseRevision" INTEGER NOT NULL,
  "saveKey" TEXT NOT NULL, "inputDigest" TEXT NOT NULL, "blobId" TEXT NOT NULL, "source" TEXT NOT NULL,
  "sourceRunId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArtifactRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ArtifactRevision_bounds" CHECK ("revision" > 0 AND "baseRevision" >= 0 AND "revision" > "baseRevision")
);
ALTER TABLE "CreationRun" ADD COLUMN "projectId" TEXT, ADD COLUMN "sessionId" TEXT;
CREATE UNIQUE INDEX "CreationProject_userId_createKey_key" ON "CreationProject"("userId", "createKey");
CREATE INDEX "CreationProject_userId_deletedAt_updatedAt_id_idx" ON "CreationProject"("userId", "deletedAt", "updatedAt", "id");
CREATE INDEX "CreationSession_projectId_updatedAt_id_idx" ON "CreationSession"("projectId", "updatedAt", "id");
CREATE UNIQUE INDEX "CreationMessage_sessionId_clientKey_key" ON "CreationMessage"("sessionId", "clientKey");
CREATE UNIQUE INDEX "CreationMessage_sessionId_sequence_key" ON "CreationMessage"("sessionId", "sequence");
CREATE UNIQUE INDEX "CreationArtifact_projectId_createKey_key" ON "CreationArtifact"("projectId", "createKey");
CREATE INDEX "CreationArtifact_projectId_deletedAt_updatedAt_id_idx" ON "CreationArtifact"("projectId", "deletedAt", "updatedAt", "id");
CREATE UNIQUE INDEX "CreationBlob_objectKey_key" ON "CreationBlob"("objectKey");
CREATE INDEX "CreationBlob_state_expiresAt_idx" ON "CreationBlob"("state", "expiresAt");
CREATE UNIQUE INDEX "ArtifactRevision_artifactId_revision_key" ON "ArtifactRevision"("artifactId", "revision");
CREATE UNIQUE INDEX "ArtifactRevision_artifactId_saveKey_key" ON "ArtifactRevision"("artifactId", "saveKey");
CREATE INDEX "ArtifactRevision_blobId_idx" ON "ArtifactRevision"("blobId");
CREATE INDEX "CreationRun_projectId_createdAt_idx" ON "CreationRun"("projectId", "createdAt");
CREATE INDEX "CreationRun_sessionId_createdAt_idx" ON "CreationRun"("sessionId", "createdAt");
ALTER TABLE "CreationProject" ADD CONSTRAINT "CreationProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreationSession" ADD CONSTRAINT "CreationSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreationMessage" ADD CONSTRAINT "CreationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CreationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreationArtifact" ADD CONSTRAINT "CreationArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactRevision" ADD CONSTRAINT "ArtifactRevision_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "CreationArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactRevision" ADD CONSTRAINT "ArtifactRevision_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "CreationBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreationRun" ADD CONSTRAINT "CreationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreationRun" ADD CONSTRAINT "CreationRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CreationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
