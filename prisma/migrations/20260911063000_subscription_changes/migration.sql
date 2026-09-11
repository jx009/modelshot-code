-- CreateTable
CREATE TABLE "SubscriptionChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionChange_subscriptionId_state_idx" ON "SubscriptionChange"("subscriptionId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionChange_userId_idempotencyKey_key" ON "SubscriptionChange"("userId", "idempotencyKey");
