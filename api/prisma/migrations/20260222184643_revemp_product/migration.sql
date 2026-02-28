/*
  Warnings:

  - You are about to drop the column `supplierId` on the `SupplierProductOffer` table. All the data in the column will be lost.
  - You are about to drop the column `supplierId` on the `SupplierVariantOffer` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[productId]` on the table `SupplierProductOffer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[variantId]` on the table `SupplierVariantOffer` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "SupplierProductOffer" DROP CONSTRAINT "SupplierProductOffer_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierVariantOffer" DROP CONSTRAINT "SupplierVariantOffer_supplierId_fkey";

-- DropIndex
DROP INDEX "SupplierProductOffer_supplierId_idx";

-- DropIndex
DROP INDEX "SupplierProductOffer_supplierId_productId_key";

-- DropIndex
DROP INDEX "SupplierVariantOffer_supplierId_idx";

-- DropIndex
DROP INDEX "SupplierVariantOffer_supplierId_variantId_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "shippingCost" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SupplierProductOffer" DROP COLUMN "supplierId";

-- AlterTable
ALTER TABLE "SupplierVariantOffer" DROP COLUMN "supplierId";

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductOffer_productId_key" ON "SupplierProductOffer"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierVariantOffer_variantId_key" ON "SupplierVariantOffer"("variantId");
