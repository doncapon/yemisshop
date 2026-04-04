/*
  Warnings:

  - A unique constraint covering the columns `[contactEmail]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.
  - Made the column `contactEmail` on table `Supplier` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "contactEmail" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_contactEmail_key" ON "Supplier"("contactEmail");
