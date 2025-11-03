/*
  Warnings:

  - A unique constraint covering the columns `[supplierOrderRef]` on the table `PurchaseOrder` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "supplierOrderRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_supplierOrderRef_key" ON "PurchaseOrder"("supplierOrderRef");
