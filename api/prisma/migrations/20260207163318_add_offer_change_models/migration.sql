-- CreateEnum
CREATE TYPE "OfferChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfferChangeScope" AS ENUM ('BASE_OFFER', 'VARIANT_OFFER');

-- CreateEnum
CREATE TYPE "ProductChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUPPLIER_OFFER_CHANGE_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPLIER_OFFER_CHANGE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPLIER_OFFER_CHANGE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'PRODUCT_CHANGE_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'PRODUCT_CHANGE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PRODUCT_CHANGE_REJECTED';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "hasPendingChanges" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupplierProductOffer" ADD COLUMN     "pendingChangeId" TEXT;

-- CreateTable
CREATE TABLE "SupplierOfferChangeRequest" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierProductOfferId" TEXT,
    "supplierVariantOfferId" TEXT,
    "scope" "OfferChangeScope" NOT NULL,
    "status" "OfferChangeStatus" NOT NULL DEFAULT 'PENDING',
    "patchJson" JSONB,
    "note" TEXT,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOfferChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductChangeRequest" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT,
    "status" "ProductChangeStatus" NOT NULL DEFAULT 'PENDING',
    "proposedPatch" JSONB NOT NULL,
    "currentSnapshot" JSONB,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "effectiveAt" TIMESTAMP(3),

    CONSTRAINT "ProductChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierOfferChangeRequest_supplierId_idx" ON "SupplierOfferChangeRequest"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierOfferChangeRequest_productId_idx" ON "SupplierOfferChangeRequest"("productId");

-- CreateIndex
CREATE INDEX "SupplierOfferChangeRequest_status_createdAt_idx" ON "SupplierOfferChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierOfferChangeRequest_scope_status_idx" ON "SupplierOfferChangeRequest"("scope", "status");

-- CreateIndex
CREATE INDEX "ProductChangeRequest_status_requestedAt_idx" ON "ProductChangeRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ProductChangeRequest_productId_status_idx" ON "ProductChangeRequest"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductChangeRequest_supplierId_status_idx" ON "ProductChangeRequest"("supplierId", "status");

-- AddForeignKey
ALTER TABLE "SupplierOfferChangeRequest" ADD CONSTRAINT "SupplierOfferChangeRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOfferChangeRequest" ADD CONSTRAINT "SupplierOfferChangeRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOfferChangeRequest" ADD CONSTRAINT "SupplierOfferChangeRequest_supplierProductOfferId_fkey" FOREIGN KEY ("supplierProductOfferId") REFERENCES "SupplierProductOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOfferChangeRequest" ADD CONSTRAINT "SupplierOfferChangeRequest_supplierVariantOfferId_fkey" FOREIGN KEY ("supplierVariantOfferId") REFERENCES "SupplierVariantOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOfferChangeRequest" ADD CONSTRAINT "SupplierOfferChangeRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOfferChangeRequest" ADD CONSTRAINT "SupplierOfferChangeRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChangeRequest" ADD CONSTRAINT "ProductChangeRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChangeRequest" ADD CONSTRAINT "ProductChangeRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChangeRequest" ADD CONSTRAINT "ProductChangeRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChangeRequest" ADD CONSTRAINT "ProductChangeRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
