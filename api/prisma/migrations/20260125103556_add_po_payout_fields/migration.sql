-- CreateEnum
CREATE TYPE "PurchaseOrderPayoutStatus" AS ENUM ('PENDING', 'HELD', 'RELEASED', 'FAILED');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "paidOutAt" TIMESTAMP(3),
ADD COLUMN     "payoutStatus" "PurchaseOrderPayoutStatus" NOT NULL DEFAULT 'PENDING';
