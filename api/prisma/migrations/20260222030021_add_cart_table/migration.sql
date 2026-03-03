-- AlterTable
ALTER TABLE "CartItem" ALTER COLUMN "kind" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "cart_line_base_unique" RENAME TO "CartItem_cartId_productId_kind_optionsKey_key";
