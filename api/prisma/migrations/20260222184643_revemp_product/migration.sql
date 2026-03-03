-- 20260222184643_revemp_product
-- Safe hotfixed migration: only add shippingCost, do NOT touch supplierId or offer uniqueness.

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "shippingCost" DECIMAL(10,2) NOT NULL DEFAULT 0;