/*
  Warnings:

  - A unique constraint covering the columns `[variantId,attributeId,valueId]` on the table `ProductVariantOption` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."ProductVariantOption_variantId_attributeId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantOption_variantId_attributeId_valueId_key" ON "ProductVariantOption"("variantId", "attributeId", "valueId");
