CREATE TABLE "WebPublication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'revoked',
  "currentRevision" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebPublication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebPublication_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "CreationArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebPublication_artifactId_key" ON "WebPublication"("artifactId");
CREATE UNIQUE INDEX "WebPublication_slug_key" ON "WebPublication"("slug");
CREATE INDEX "WebPublication_userId_updatedAt_idx" ON "WebPublication"("userId", "updatedAt");
CREATE INDEX "WebPublication_status_slug_idx" ON "WebPublication"("status", "slug");

CREATE TABLE "WebPublicationRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "publicationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "artifactRevisionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebPublicationRevision_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "WebPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WebPublicationRevision_artifactRevisionId_fkey" FOREIGN KEY ("artifactRevisionId") REFERENCES "ArtifactRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebPublicationRevision_publicationId_revision_key" ON "WebPublicationRevision"("publicationId", "revision");
CREATE INDEX "WebPublicationRevision_artifactRevisionId_idx" ON "WebPublicationRevision"("artifactRevisionId");

CREATE TABLE "WebPublicationCommand" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "publicationId" TEXT NOT NULL,
  "saveKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resultRevision" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebPublicationCommand_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "WebPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebPublicationCommand_publicationId_saveKey_key" ON "WebPublicationCommand"("publicationId", "saveKey");
CREATE INDEX "WebPublicationCommand_publicationId_createdAt_idx" ON "WebPublicationCommand"("publicationId", "createdAt");
