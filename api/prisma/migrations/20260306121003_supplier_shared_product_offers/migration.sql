/*
  Warnings:

  - A unique constraint covering the columns `[productId,supplierId]` on the table `SupplierProductOffer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[variantId,supplierId]` on the table `SupplierVariantOffer` will be added. If there are existing duplicate values, this will fail.
  - Made the column `supplierId` on table `SupplierVariantOffer` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "SupplierVariantOffer" DROP CONSTRAINT "SupplierVariantOffer_supplierId_fkey";

-- DropIndex
DROP INDEX "SupplierVariantOffer_variantId_key";

-- AlterTable
ALTER TABLE "SupplierVariantOffer" ALTER COLUMN "supplierId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductOffer_productId_supplierId_key" ON "SupplierProductOffer"("productId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_supplierId_idx" ON "SupplierVariantOffer"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierVariantOffer_variantId_supplierId_key" ON "SupplierVariantOffer"("variantId", "supplierId");

-- AddForeignKey
ALTER TABLE "SupplierVariantOffer" ADD CONSTRAINT "SupplierVariantOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
