-- CreateIndex
CREATE INDEX "OrderActivity_orderId_createdAt_idx" ON "OrderActivity"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderActivity_type_createdAt_idx" ON "OrderActivity"("type", "createdAt");
