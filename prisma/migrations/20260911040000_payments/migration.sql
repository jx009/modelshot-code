-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- AlterTable
ALTER TABLE "AgentCommissionSettlementLog" DROP COLUMN "amount",
DROP COLUMN "pendingCommissionAfter",
ADD COLUMN     "amountMinor" INTEGER NOT NULL,
ADD COLUMN     "businessKey" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN     "pendingMinorAfter" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "CreditReservation" ADD COLUMN     "allocations" JSONB;

-- AlterTable
ALTER TABLE "InviteCommission" DROP COLUMN "commissionAmount",
DROP COLUMN "commissionRate",
DROP COLUMN "orderAmount",
ADD COLUMN     "amountMinor" INTEGER NOT NULL,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN     "orderAmountMinor" INTEGER NOT NULL,
ADD COLUMN     "rateBps" INTEGER NOT NULL,
ADD COLUMN     "reversedMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "amount",
ADD COLUMN     "amountMinor" INTEGER NOT NULL,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "manualReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiptUrl" TEXT,
ADD COLUMN     "reclaimedCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeInvoiceId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "scheduledPlanId" TEXT,
    "latestEventAt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAdjustment" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "remaining" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "PaymentEvent_state_receivedAt_idx" ON "PaymentEvent"("state", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionAdjustment_businessKey_key" ON "CommissionAdjustment"("businessKey");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_inviterId_settledAt_idx" ON "CommissionAdjustment"("inviterId", "settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLot_orderId_key" ON "CreditLot"("orderId");

-- CreateIndex
CREATE INDEX "CreditLot_userId_createdAt_idx" ON "CreditLot"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCommissionSettlementLog_businessKey_key" ON "AgentCommissionSettlementLog"("businessKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripePaymentIntentId_key" ON "Order"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripeInvoiceId_key" ON "Order"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
