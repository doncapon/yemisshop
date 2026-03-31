-- CreateTable
CREATE TABLE "PhoneRegistry" (
    "id" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "countryCode" TEXT,
    "national" TEXT,
    "purpose" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneRegistry_e164_key" ON "PhoneRegistry"("e164");

-- CreateIndex
CREATE INDEX "PhoneRegistry_ownerType_ownerId_idx" ON "PhoneRegistry"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "PhoneRegistry_countryCode_idx" ON "PhoneRegistry"("countryCode");

-- CreateIndex
CREATE INDEX "Employee_phone_idx" ON "Employee"("phone");

-- CreateIndex
CREATE INDEX "Supplier_whatsappPhone_idx" ON "Supplier"("whatsappPhone");

-- CreateIndex
CREATE INDEX "Supplier_pickupContactPhone_idx" ON "Supplier"("pickupContactPhone");

-- CreateIndex
CREATE INDEX "SupplierRider_phone_idx" ON "SupplierRider"("phone");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "UserShippingAddress_phone_idx" ON "UserShippingAddress"("phone");

-- CreateIndex
CREATE INDEX "UserShippingAddress_whatsappPhone_idx" ON "UserShippingAddress"("whatsappPhone");
