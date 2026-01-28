/*
  Warnings:

  - The values [PENDING] on the enum `PurchaseOrderStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "BankVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "PurchaseOrderStatus_new" AS ENUM ('CREATED', 'FUNDED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELED');
ALTER TABLE "public"."PurchaseOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" TYPE "PurchaseOrderStatus_new" USING ("status"::text::"PurchaseOrderStatus_new");
ALTER TYPE "PurchaseOrderStatus" RENAME TO "PurchaseOrderStatus_old";
ALTER TYPE "PurchaseOrderStatus_new" RENAME TO "PurchaseOrderStatus";
DROP TYPE "public"."PurchaseOrderStatus_old";
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" SET DEFAULT 'CREATED';
COMMIT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "bankVerificationNote" TEXT,
ADD COLUMN     "bankVerificationRequestedAt" TIMESTAMP(3),
ADD COLUMN     "bankVerificationStatus" "BankVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "bankVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "bankVerifiedById" TEXT;
