/*
  Warnings:

  - A unique constraint covering the columns `[variantId]` on the table `SupplierVariantOffer` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "SupplierProductOffer" DROP CONSTRAINT "SupplierProductOffer_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierVariantOffer" DROP CONSTRAINT "SupplierVariantOffer_supplierId_fkey";

-- DropIndex
DROP INDEX "SupplierProductOffer_supplierId_productId_key";

-- DropIndex
DROP INDEX "SupplierVariantOffer_supplierId_idx";

-- DropIndex
DROP INDEX "SupplierVariantOffer_supplierId_variantId_key";

-- AlterTable
ALTER TABLE "SupplierVariantOffer" ALTER COLUMN "supplierId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierVariantOffer_variantId_key" ON "SupplierVariantOffer"("variantId");

-- AddForeignKey
ALTER TABLE "SupplierProductOffer" ADD CONSTRAINT "SupplierProductOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
