-- CreateEnum
CREATE TYPE "SupplierFulfillmentMode" AS ENUM ('SUPPLIER_SELF_SHIP', 'COURIER_DROPOFF', 'PLATFORM_LABEL', 'MANUAL_QUOTE');

-- CreateEnum
CREATE TYPE "SupplierShippingProfileMode" AS ENUM ('DEFAULT_PLATFORM', 'SUPPLIER_OVERRIDDEN', 'MANUAL_QUOTE');

-- DropIndex
DROP INDEX "ShippingRateCard_zoneId_isActive_idx";

-- AlterTable
ALTER TABLE "ShippingRateCard" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "defaultServiceLevel" "DeliveryServiceLevel" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "shippingProfileMode" "SupplierShippingProfileMode" NOT NULL DEFAULT 'DEFAULT_PLATFORM';

-- CreateTable
CREATE TABLE "SupplierShippingProfile" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "originZoneCode" TEXT,
    "fulfillmentMode" "SupplierFulfillmentMode" NOT NULL DEFAULT 'SUPPLIER_SELF_SHIP',
    "preferredCarrier" TEXT,
    "localFlatFee" DECIMAL(10,2),
    "nearbyFlatFee" DECIMAL(10,2),
    "nationwideBaseFee" DECIMAL(10,2),
    "defaultHandlingFee" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierShippingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRouteRateCard" (
    "id" TEXT NOT NULL,
    "originZoneCode" TEXT NOT NULL,
    "destinationZoneCode" TEXT NOT NULL,
    "serviceLevel" "DeliveryServiceLevel" NOT NULL,
    "parcelClass" "ShippingParcelClass" NOT NULL,
    "minWeightGrams" INTEGER NOT NULL,
    "maxWeightGrams" INTEGER,
    "baseFee" DECIMAL(10,2) NOT NULL,
    "perKgFee" DECIMAL(10,2),
    "remoteSurcharge" DECIMAL(10,2),
    "fuelSurcharge" DECIMAL(10,2),
    "handlingFee" DECIMAL(10,2),
    "etaMinDays" INTEGER,
    "etaMaxDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRouteRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierShippingProfile_supplierId_key" ON "SupplierShippingProfile"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierShippingProfile_originZoneCode_isActive_idx" ON "SupplierShippingProfile"("originZoneCode", "isActive");

-- CreateIndex
CREATE INDEX "ShippingRouteRateCard_originZoneCode_destinationZoneCode_is_idx" ON "ShippingRouteRateCard"("originZoneCode", "destinationZoneCode", "isActive");

-- CreateIndex
CREATE INDEX "ShippingRouteRateCard_serviceLevel_parcelClass_isActive_idx" ON "ShippingRouteRateCard"("serviceLevel", "parcelClass", "isActive");

-- CreateIndex
CREATE INDEX "ShippingRouteRateCard_minWeightGrams_maxWeightGrams_idx" ON "ShippingRouteRateCard"("minWeightGrams", "maxWeightGrams");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRouteRateCard_originZoneCode_destinationZoneCode_se_key" ON "ShippingRouteRateCard"("originZoneCode", "destinationZoneCode", "serviceLevel", "parcelClass", "minWeightGrams", "maxWeightGrams");

-- CreateIndex
CREATE INDEX "ShippingRateCard_supplierId_zoneId_isActive_idx" ON "ShippingRateCard"("supplierId", "zoneId", "isActive");

-- AddForeignKey
ALTER TABLE "SupplierShippingProfile" ADD CONSTRAINT "SupplierShippingProfile_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRateCard" ADD CONSTRAINT "ShippingRateCard_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
