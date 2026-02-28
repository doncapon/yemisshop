/*
  Warnings:

  - A unique constraint covering the columns `[brandId,sku,isDeleted]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - Made the column `brandId` on table `Product` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_brandId_fkey";

-- DropIndex
DROP INDEX "Product_sku_isDeleted_key";

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "brandId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Product_brandId_sku_isDeleted_key" ON "Product"("brandId", "sku", "isDeleted");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
