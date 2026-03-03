-- drop old unique if it exists
DROP INDEX IF EXISTS "cart_line_unique";

-- or if prisma created it with a different name:
-- DROP INDEX IF EXISTS "CartItem_cartId_productId_variantId_kind_optionsKey_key";

-- create new uniques
CREATE UNIQUE INDEX "cart_line_base_unique"
ON "CartItem" ("cartId", "productId", "kind", "optionsKey");

CREATE UNIQUE INDEX "cart_line_variant_unique"
ON "CartItem" ("cartId", "productId", "variantId", "kind", "optionsKey");