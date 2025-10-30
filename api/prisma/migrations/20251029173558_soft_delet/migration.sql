/*
  Warnings:

  - A unique constraint covering the columns `[sku,isDeleted]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Product_isDeleted_createdAt_idx" ON "Product"("isDeleted", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_isDeleted_key" ON "Product"("sku", "isDeleted");
