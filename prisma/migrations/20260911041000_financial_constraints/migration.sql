ALTER TABLE "AdminAuditLog" ADD COLUMN "businessKey" TEXT, ADD COLUMN "digest" TEXT;
CREATE UNIQUE INDEX "AdminAuditLog_businessKey_key" ON "AdminAuditLog"("businessKey");
ALTER TABLE "Order" ADD CONSTRAINT "Order_valid_amounts" CHECK ("amountMinor" >= 0 AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor" AND "reclaimedCredits" >= 0);
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_valid_amounts" CHECK ("remaining" >= 0 AND "reserved" >= 0 AND "reserved" <= "remaining");
ALTER TABLE "InviteCommission" ADD CONSTRAINT "Commission_valid_amounts" CHECK ("amountMinor" >= 0 AND "reversedMinor" >= 0 AND "reversedMinor" <= "amountMinor" AND "rateBps" BETWEEN 0 AND 10000);
