-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LOW_STOCK';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "lastLowStockNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "notifyLowStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyNewOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPayouts" BOOLEAN NOT NULL DEFAULT true;
