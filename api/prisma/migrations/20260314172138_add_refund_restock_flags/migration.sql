-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "restockApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stockRestoredAt" TIMESTAMP(3),
ADD COLUMN     "stockRestoredById" TEXT;
