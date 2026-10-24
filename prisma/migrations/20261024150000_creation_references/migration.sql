CREATE TABLE "CreationReference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreationReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreationReference_objectKey_key" ON "CreationReference"("objectKey");
CREATE INDEX "CreationReference_userId_sessionId_deletedAt_createdAt_idx" ON "CreationReference"("userId", "sessionId", "deletedAt", "createdAt");
ALTER TABLE "CreationReference" ADD CONSTRAINT "CreationReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreationReference" ADD CONSTRAINT "CreationReference_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CreationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
