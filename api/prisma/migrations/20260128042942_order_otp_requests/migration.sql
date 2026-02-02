-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "deliveredByUserId" TEXT,
ADD COLUMN     "deliveredMetaJson" JSONB,
ADD COLUMN     "deliveryOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "deliveryOtpHash" TEXT,
ADD COLUMN     "deliveryOtpIssuedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryOtpIssuedToUserId" TEXT,
ADD COLUMN     "deliveryOtpLockedUntil" TIMESTAMP(3),
ADD COLUMN     "deliveryOtpVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderOtpRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderOtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderOtpRequest_requestId_key" ON "OrderOtpRequest"("requestId");

-- CreateIndex
CREATE INDEX "OrderOtpRequest_orderId_idx" ON "OrderOtpRequest"("orderId");

-- CreateIndex
CREATE INDEX "OrderOtpRequest_userId_idx" ON "OrderOtpRequest"("userId");

-- CreateIndex
CREATE INDEX "OrderOtpRequest_purpose_idx" ON "OrderOtpRequest"("purpose");

-- CreateIndex
CREATE INDEX "OrderOtpRequest_orderId_purpose_idx" ON "OrderOtpRequest"("orderId", "purpose");

-- AddForeignKey
ALTER TABLE "OrderOtpRequest" ADD CONSTRAINT "OrderOtpRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOtpRequest" ADD CONSTRAINT "OrderOtpRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
