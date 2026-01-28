-- AlterEnum
ALTER TYPE "SupplierPaymentStatus" ADD VALUE 'APPROVED';

-- CreateTable
CREATE TABLE "PurchaseOrderDeliveryOtp" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderDeliveryOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderDeliveryOtp_purchaseOrderId_idx" ON "PurchaseOrderDeliveryOtp"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderDeliveryOtp_orderId_idx" ON "PurchaseOrderDeliveryOtp"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderDeliveryOtp_customerId_idx" ON "PurchaseOrderDeliveryOtp"("customerId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderDeliveryOtp" ADD CONSTRAINT "PurchaseOrderDeliveryOtp_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDeliveryOtp" ADD CONSTRAINT "PurchaseOrderDeliveryOtp_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDeliveryOtp" ADD CONSTRAINT "PurchaseOrderDeliveryOtp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
