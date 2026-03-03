/*
  Warnings:

  - A unique constraint covering the columns `[supplierId,brandId,sku,isDeleted]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Product_brandId_sku_isDeleted_key";

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplierId_brandId_sku_isDeleted_key" ON "Product"("supplierId", "brandId", "sku", "isDeleted");
