/*
  Warnings:

  - The `status` column on the `Cart` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `kind` column on the `CartItem` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "CartItemKind" AS ENUM ('BASE', 'VARIANT');

-- DropIndex
DROP INDEX "Cart_userId_key";

-- AlterTable
ALTER TABLE "Cart" DROP COLUMN "status",
ADD COLUMN     "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "CartItem" DROP COLUMN "kind",
ADD COLUMN     "kind" "CartItemKind" NOT NULL DEFAULT 'BASE';

-- CreateIndex
CREATE INDEX "Cart_userId_status_idx" ON "Cart"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_productId_variantId_kind_optionsKey_key" ON "CartItem"("cartId", "productId", "variantId", "kind", "optionsKey");
