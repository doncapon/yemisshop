-- CreateTable
CREATE TABLE "CustomerRefundPayout" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT,
    "recipientCode" TEXT,
    "transferReference" TEXT,
    "transferStatus" TEXT,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRefundPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRefundPayout_refundId_key" ON "CustomerRefundPayout"("refundId");

-- CreateIndex
CREATE INDEX "CustomerRefundPayout_userId_createdAt_idx" ON "CustomerRefundPayout"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerRefundPayout" ADD CONSTRAINT "CustomerRefundPayout_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefundPayout" ADD CONSTRAINT "CustomerRefundPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
