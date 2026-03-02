/*
  Warnings:

  - A unique constraint covering the columns `[supplierId,productId,userId]` on the table `SupplierReview` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `SupplierReview` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "SupplierReview_purchaseOrderId_userId_key";

-- AlterTable
ALTER TABLE "SupplierReview" ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "purchaseOrderId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReview_supplierId_productId_userId_key" ON "SupplierReview"("supplierId", "productId", "userId");
