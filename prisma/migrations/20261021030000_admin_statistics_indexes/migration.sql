CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "Order_currency_paidAt_idx" ON "Order"("currency", "paidAt");
CREATE INDEX "TryOn_createTime_idx" ON "TryOn"("createTime");
CREATE INDEX "TryOn_qaStatus_reviewDecision_idx" ON "TryOn"("qaStatus", "reviewDecision");
