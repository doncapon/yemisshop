/*
  Warnings:

  - You are about to drop the column `shippingAddressId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_shippingAddressId_fkey";

-- DropIndex
DROP INDEX "User_shippingAddressId_key";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "selectedUserShippingAddressId" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "shippingAddressId",
ADD COLUMN     "defaultShippingAddressId" TEXT;

-- CreateTable
CREATE TABLE "UserShippingAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT,
    "phone" TEXT NOT NULL,
    "whatsappPhone" TEXT,
    "houseNumber" TEXT,
    "streetName" TEXT,
    "postCode" TEXT,
    "town" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "lga" TEXT,
    "landmark" TEXT,
    "directionsNote" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isValidated" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "placeId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validationSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserShippingAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserShippingAddress_userId_createdAt_idx" ON "UserShippingAddress"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserShippingAddress_userId_isDefault_idx" ON "UserShippingAddress"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "UserShippingAddress_userId_isActive_idx" ON "UserShippingAddress"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Order_selectedUserShippingAddressId_idx" ON "Order"("selectedUserShippingAddressId");

-- CreateIndex
CREATE INDEX "User_defaultShippingAddressId_idx" ON "User"("defaultShippingAddressId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultShippingAddressId_fkey" FOREIGN KEY ("defaultShippingAddressId") REFERENCES "UserShippingAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserShippingAddress" ADD CONSTRAINT "UserShippingAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_selectedUserShippingAddressId_fkey" FOREIGN KEY ("selectedUserShippingAddressId") REFERENCES "UserShippingAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
