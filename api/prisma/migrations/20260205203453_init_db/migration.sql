/*
  Warnings:

  - The values [REFUND_UPDATED,DISPUTE_UPDATED] on the enum `NotificationType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `priceBump` on the `ProductVariantOption` table. All the data in the column will be lost.
  - You are about to drop the column `priceBump` on the `SupplierVariantOffer` table. All the data in the column will be lost.
  - Added the required column `unitPrice` to the `SupplierVariantOffer` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('ORDER_PLACED', 'ORDER_PAID', 'ORDER_CANCELED', 'PURCHASE_ORDER_CREATED', 'PURCHASE_ORDER_FUNDED', 'PURCHASE_ORDER_STATUS_UPDATE', 'RIDER_ASSIGNED', 'RIDER_DELIVERED', 'PAYMENT_FAILED', 'PRODUCT_SUBMITTED', 'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'PRODUCT_DISABLED', 'REFUND_REQUESTED', 'REFUND_STATUS_CHANGED', 'DISPUTE_OPENED', 'DISPUTE_STATUS_CHANGED', 'SUPPLIER_PAYOUT_RELEASED', 'SUPPLIER_PAYOUT_HELD', 'SUPPLIER_PAYOUT_FAILED', 'SUPPLIER_REVIEW_RECEIVED', 'SUPPLIER_KYC_STATUS_CHANGED', 'SUPPLIER_BANK_STATUS_CHANGED', 'GENERIC');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- AlterTable
ALTER TABLE "ProductVariantOption" DROP COLUMN "priceBump";

-- AlterTable
ALTER TABLE "SupplierVariantOffer" DROP COLUMN "priceBump",
ADD COLUMN     "unitPrice" DECIMAL(10,2) NOT NULL;
