-- AlterTable
ALTER TABLE "User" ADD CONSTRAINT "User_credits_nonnegative" CHECK ("credits" >= 0);

-- AlterTable
ALTER TABLE "BatchJob" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "businessKey" TEXT,
ADD COLUMN     "cycleId" TEXT,
ADD COLUMN     "sourceTransactionId" TEXT;

-- AlterTable
ALTER TABLE "TryOn" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAssetId" TEXT,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "exportStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "fence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "metadataStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "originalAssetId" TEXT,
ADD COLUMN     "qaStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "reconcileUntil" TIMESTAMP(3),
ADD COLUMN     "retryOfId" TEXT,
ADD COLUMN     "reviewDecision" TEXT,
ADD COLUMN     "snapshot" JSONB;

-- CreateTable
CREATE TABLE "AssetReference" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "AssetReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCycle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "quota" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "subscriptionId" TEXT,

    CONSTRAINT "BillingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "pricing" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tryOnId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "cycleId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'held',
    "sourceTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationAttempt" (
    "id" TEXT NOT NULL,
    "tryOnId" TEXT NOT NULL,
    "fence" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "requestId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'claimed',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetReference_assetId_entityId_kind_key" ON "AssetReference"("assetId", "entityId", "kind");

-- CreateIndex
CREATE INDEX "BillingCycle_userId_startsAt_endsAt_idx" ON "BillingCycle"("userId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "GenerationQuote_userId_createdAt_idx" ON "GenerationQuote"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_tryOnId_key" ON "CreditReservation"("tryOnId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_sourceTransactionId_key" ON "CreditReservation"("sourceTransactionId");

-- CreateIndex
CREATE INDEX "CreditReservation_userId_state_idx" ON "CreditReservation"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationAttempt_tryOnId_fence_key" ON "GenerationAttempt"("tryOnId", "fence");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_businessKey_key" ON "OutboxEvent"("businessKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_deliveredAt_availableAt_idx" ON "OutboxEvent"("deliveredAt", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "BatchJob_quoteId_key" ON "BatchJob"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchJob_userId_idempotencyKey_key" ON "BatchJob"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_businessKey_key" ON "CreditTransaction"("businessKey");

-- AddForeignKey
ALTER TABLE "AssetReference" ADD CONSTRAINT "AssetReference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationQuote" ADD CONSTRAINT "GenerationQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_tryOnId_fkey" FOREIGN KEY ("tryOnId") REFERENCES "TryOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationAttempt" ADD CONSTRAINT "GenerationAttempt_tryOnId_fkey" FOREIGN KEY ("tryOnId") REFERENCES "TryOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchJob" ADD CONSTRAINT "BatchJob_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "GenerationQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_conservation" CHECK ("quota" >= 0 AND "used" >= 0 AND "reserved" >= 0 AND "used" + "reserved" <= "quota" AND "endsAt" > "startsAt");
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_valid" CHECK ("amount" >= 0 AND "state" IN ('held', 'captured', 'released') AND ("channel" <> 'subscription' OR "cycleId" IS NOT NULL));
