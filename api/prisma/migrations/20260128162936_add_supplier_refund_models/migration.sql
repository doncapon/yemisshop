-- CreateEnum
CREATE TYPE "SupplierLedgerType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "SupplierLedgerReason" AS ENUM ('PAYOUT_RELEASED', 'REFUND_DEBIT', 'ADJUSTMENT', 'WITHDRAWAL');

-- AlterTable
ALTER TABLE "SupplierLedgerEntry" ADD COLUMN     "reason" TEXT;
