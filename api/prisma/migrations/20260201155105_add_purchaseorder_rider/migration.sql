-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "riderId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseOrder_riderId_idx" ON "PurchaseOrder"("riderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "SupplierRider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
