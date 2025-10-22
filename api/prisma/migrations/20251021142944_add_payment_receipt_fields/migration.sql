/*
  Warnings:

  - A unique constraint covering the columns `[receiptNo]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "receiptData" JSONB,
ADD COLUMN     "receiptIssuedAt" TIMESTAMP(3),
ADD COLUMN     "receiptNo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");
