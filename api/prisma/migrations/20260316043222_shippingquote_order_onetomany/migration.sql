-- DropIndex
DROP INDEX "ShippingQuote_orderId_key";

-- CreateIndex
CREATE INDEX "ShippingQuote_orderId_idx" ON "ShippingQuote"("orderId");
