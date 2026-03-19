-- CreateIndex
CREATE INDEX "Product_status_isDeleted_createdAt_idx" ON "Product"("status", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "Product_status_categoryId_isDeleted_createdAt_idx" ON "Product"("status", "categoryId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "Product_status_brandId_isDeleted_createdAt_idx" ON "Product"("status", "brandId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_archivedAt_idx" ON "ProductVariant"("productId", "isActive", "archivedAt");

-- CreateIndex
CREATE INDEX "SupplierProductOffer_productId_isActive_inStock_availableQt_idx" ON "SupplierProductOffer"("productId", "isActive", "inStock", "availableQty");

-- CreateIndex
CREATE INDEX "SupplierProductOffer_productId_supplierId_idx" ON "SupplierProductOffer"("productId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_productId_isActive_inStock_availableQt_idx" ON "SupplierVariantOffer"("productId", "isActive", "inStock", "availableQty");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_variantId_isActive_inStock_availableQt_idx" ON "SupplierVariantOffer"("variantId", "isActive", "inStock", "availableQty");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_productId_variantId_idx" ON "SupplierVariantOffer"("productId", "variantId");
