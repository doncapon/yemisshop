/*
  Warnings:

  - Changed the type of `role` on the `User` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ShippingRateSource" AS ENUM ('FALLBACK_ZONE', 'LIVE_CARRIER', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShippingQuoteStatus" AS ENUM ('DRAFT', 'SELECTED', 'EXPIRED', 'CONVERTED_TO_ORDER', 'CANCELED');

-- CreateEnum
CREATE TYPE "DeliveryServiceLevel" AS ENUM ('STANDARD', 'EXPRESS', 'PICKUP_POINT', 'SAME_DAY');

-- CreateEnum
CREATE TYPE "ShippingParcelClass" AS ENUM ('STANDARD', 'FRAGILE', 'BULKY');

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "directionsNote" TEXT,
ADD COLUMN     "isValidated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "placeId" TEXT,
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validationSource" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingCurrency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "shippingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shippingRateSource" "ShippingRateSource";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "freeShipping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "heightCm" DECIMAL(10,2),
ADD COLUMN     "isBulky" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFragile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lengthCm" DECIMAL(10,2),
ADD COLUMN     "shippingClass" TEXT,
ADD COLUMN     "weightGrams" INTEGER,
ADD COLUMN     "widthCm" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "heightCm" DECIMAL(10,2),
ADD COLUMN     "isBulkyOverride" BOOLEAN,
ADD COLUMN     "isFragileOverride" BOOLEAN,
ADD COLUMN     "lengthCm" DECIMAL(10,2),
ADD COLUMN     "shippingClassOverride" TEXT,
ADD COLUMN     "weightGrams" INTEGER,
ADD COLUMN     "widthCm" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "shippedFromAddressId" TEXT,
ADD COLUMN     "shippedToAddressId" TEXT,
ADD COLUMN     "shippingCarrierName" TEXT,
ADD COLUMN     "shippingCostActual" DECIMAL(12,2),
ADD COLUMN     "shippingCurrency" TEXT DEFAULT 'NGN',
ADD COLUMN     "shippingFeeChargedToCustomer" DECIMAL(12,2),
ADD COLUMN     "shippingLabelUrl" TEXT,
ADD COLUMN     "shippingMargin" DECIMAL(12,2),
ADD COLUMN     "shippingServiceLevel" TEXT,
ADD COLUMN     "trackingNumber" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "defaultLeadDays" INTEGER,
ADD COLUMN     "handlingFee" DECIMAL(10,2),
ADD COLUMN     "pickupAddressId" TEXT,
ADD COLUMN     "pickupContactName" TEXT,
ADD COLUMN     "pickupContactPhone" TEXT,
ADD COLUMN     "pickupInstructions" TEXT,
ADD COLUMN     "sameDayCutoffHour" INTEGER,
ADD COLUMN     "shippingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shipsNationwide" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsDoorDelivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsPickupPoint" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User"
ALTER COLUMN "role" TYPE "Role"
USING ("role"::text::"Role");

-- CreateTable
CREATE TABLE "ShippingChargeReconciliation" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "customerCharged" DECIMAL(12,2) NOT NULL,
    "carrierCharged" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "carrierName" TEXT,
    "carrierRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingChargeReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "statesJson" JSONB,
    "lgasJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRateCard" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "serviceLevel" "DeliveryServiceLevel" NOT NULL DEFAULT 'STANDARD',
    "parcelClass" "ShippingParcelClass" NOT NULL DEFAULT 'STANDARD',
    "minWeightGrams" INTEGER NOT NULL,
    "maxWeightGrams" INTEGER,
    "volumetricDivisor" INTEGER,
    "maxLengthCm" DECIMAL(10,2),
    "maxWidthCm" DECIMAL(10,2),
    "maxHeightCm" DECIMAL(10,2),
    "baseFee" DECIMAL(10,2) NOT NULL,
    "perKgFee" DECIMAL(10,2),
    "remoteSurcharge" DECIMAL(10,2),
    "fuelSurcharge" DECIMAL(10,2),
    "handlingFee" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "etaMinDays" INTEGER,
    "etaMaxDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "supplierId" TEXT NOT NULL,
    "pickupAddressId" TEXT,
    "destinationAddressId" TEXT,
    "rateSource" "ShippingRateSource" NOT NULL,
    "status" "ShippingQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "carrierName" TEXT,
    "carrierServiceCode" TEXT,
    "carrierQuoteRef" TEXT,
    "serviceLevel" "DeliveryServiceLevel" NOT NULL DEFAULT 'STANDARD',
    "zoneCode" TEXT,
    "zoneName" TEXT,
    "totalActualWeightGrams" INTEGER,
    "totalVolumetricWeightGrams" INTEGER,
    "chargeableWeightGrams" INTEGER,
    "parcelCount" INTEGER DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "shippingFee" DECIMAL(12,2) NOT NULL,
    "remoteSurcharge" DECIMAL(12,2),
    "fuelSurcharge" DECIMAL(12,2),
    "handlingFee" DECIMAL(12,2),
    "insuranceFee" DECIMAL(12,2),
    "totalFee" DECIMAL(12,2) NOT NULL,
    "etaMinDays" INTEGER,
    "etaMaxDays" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "providerRequestJson" JSONB,
    "providerResponseJson" JSONB,
    "pricingMetaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuoteItem" (
    "id" TEXT NOT NULL,
    "shippingQuoteId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "productTitle" TEXT,
    "sku" TEXT,
    "qty" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "lengthCm" DECIMAL(10,2),
    "widthCm" DECIMAL(10,2),
    "heightCm" DECIMAL(10,2),
    "actualWeightGrams" INTEGER,
    "volumetricWeightGrams" INTEGER,
    "chargeableWeightGrams" INTEGER,
    "isFragile" BOOLEAN NOT NULL DEFAULT false,
    "isBulky" BOOLEAN NOT NULL DEFAULT false,
    "shippingClass" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingChargeReconciliation_purchaseOrderId_key" ON "ShippingChargeReconciliation"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "ShippingChargeReconciliation_status_createdAt_idx" ON "ShippingChargeReconciliation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZone_code_key" ON "ShippingZone"("code");

-- CreateIndex
CREATE INDEX "ShippingZone_isActive_priority_idx" ON "ShippingZone"("isActive", "priority");

-- CreateIndex
CREATE INDEX "ShippingRateCard_zoneId_isActive_idx" ON "ShippingRateCard"("zoneId", "isActive");

-- CreateIndex
CREATE INDEX "ShippingRateCard_serviceLevel_parcelClass_isActive_idx" ON "ShippingRateCard"("serviceLevel", "parcelClass", "isActive");

-- CreateIndex
CREATE INDEX "ShippingRateCard_minWeightGrams_maxWeightGrams_idx" ON "ShippingRateCard"("minWeightGrams", "maxWeightGrams");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingQuote_orderId_key" ON "ShippingQuote"("orderId");

-- CreateIndex
CREATE INDEX "ShippingQuote_supplierId_createdAt_idx" ON "ShippingQuote"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingQuote_userId_createdAt_idx" ON "ShippingQuote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingQuote_status_createdAt_idx" ON "ShippingQuote"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingQuote_rateSource_createdAt_idx" ON "ShippingQuote"("rateSource", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingQuoteItem_shippingQuoteId_idx" ON "ShippingQuoteItem"("shippingQuoteId");

-- CreateIndex
CREATE INDEX "ShippingQuoteItem_productId_idx" ON "ShippingQuoteItem"("productId");

-- CreateIndex
CREATE INDEX "ShippingQuoteItem_variantId_idx" ON "ShippingQuoteItem"("variantId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_shippedFromAddressId_idx" ON "PurchaseOrder"("shippedFromAddressId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_shippedToAddressId_idx" ON "PurchaseOrder"("shippedToAddressId");

-- CreateIndex
CREATE INDEX "Supplier_pickupAddressId_idx" ON "Supplier"("pickupAddressId");

-- AddForeignKey
ALTER TABLE "ShippingChargeReconciliation" ADD CONSTRAINT "ShippingChargeReconciliation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_pickupAddressId_fkey" FOREIGN KEY ("pickupAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRateCard" ADD CONSTRAINT "ShippingRateCard_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ShippingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_pickupAddressId_fkey" FOREIGN KEY ("pickupAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_destinationAddressId_fkey" FOREIGN KEY ("destinationAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuoteItem" ADD CONSTRAINT "ShippingQuoteItem_shippingQuoteId_fkey" FOREIGN KEY ("shippingQuoteId") REFERENCES "ShippingQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_shippedFromAddressId_fkey" FOREIGN KEY ("shippedFromAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_shippedToAddressId_fkey" FOREIGN KEY ("shippedToAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
