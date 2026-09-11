-- AlterTable
ALTER TABLE "TryOn" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProcessingStep" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "fence" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "report" JSONB,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "selection" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "objectKey" TEXT,
    "bytes" INTEGER,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failures" JSONB,
    "expiresAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessingStep_state_leaseUntil_idx" ON "ProcessingStep"("state", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingStep_entityId_kind_key" ON "ProcessingStep"("entityId", "kind");

-- CreateIndex
CREATE INDEX "ExportJob_userId_createdAt_idx" ON "ExportJob"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_userId_idempotencyKey_key" ON "ExportJob"("userId", "idempotencyKey");
