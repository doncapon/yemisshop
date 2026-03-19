-- AlterTable
ALTER TABLE "UserShippingAddress" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerifiedBy" TEXT,
ADD COLUMN     "verificationMeta" JSONB,
ADD COLUMN     "whatsappVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "UserShippingAddress_userId_phoneVerifiedAt_idx" ON "UserShippingAddress"("userId", "phoneVerifiedAt");
