-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "payoutHoldUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierPaymentAllocation" ADD COLUMN     "holdUntil" TIMESTAMP(3);
