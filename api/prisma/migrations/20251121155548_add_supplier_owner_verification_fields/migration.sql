/*
  Warnings:

  - A unique constraint covering the columns `[rcNumber]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SupplierCompanyType" AS ENUM ('BUSINESS_NAME', 'COMPANY', 'INCORPORATED_TRUSTEES', 'LIMITED_PARTNERSHIP', 'LIMITED_LIABILITY_PARTNERSHIP');

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "lga" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "companyType" "SupplierCompanyType",
ADD COLUMN     "dateOfRegistration" TIMESTAMP(3),
ADD COLUMN     "kycRawPayload" JSONB,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "natureOfBusiness" TEXT,
ADD COLUMN     "ownerVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proprietorAffiliateJson" JSONB,
ADD COLUMN     "proprietorBvnMasked" TEXT,
ADD COLUMN     "rcNumber" TEXT,
ADD COLUMN     "registeredAddressId" TEXT,
ADD COLUMN     "shareCapital" DECIMAL(65,30),
ADD COLUMN     "shareDetails" JSONB;

-- CreateTable
CREATE TABLE "SupplierAffiliate" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phoneNumber" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "affiliateType" TEXT,
    "affiliateCategoryType" TEXT,
    "occupation" TEXT,
    "country" TEXT,
    "idNumber" TEXT,
    "idType" TEXT,
    "addressId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierAffiliate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_rcNumber_key" ON "Supplier"("rcNumber");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_registeredAddressId_fkey" FOREIGN KEY ("registeredAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAffiliate" ADD CONSTRAINT "SupplierAffiliate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAffiliate" ADD CONSTRAINT "SupplierAffiliate_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
