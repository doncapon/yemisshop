/*
  Warnings:

  - You are about to drop the column `companyType` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `dateOfRegistration` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `kycProvider` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `kycRawPayload` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `kycRegistrationStatus` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `ownerVerified` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `proprietorBvnMasked` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `rcNumber` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `shareCapital` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `shareDetails` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the `CacLookup` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CacRegistrationCache` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CacVerificationTicket` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CacVerifyAttempt` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SupplierDocumentKind" AS ENUM ('BUSINESS_REGISTRATION_CERTIFICATE', 'GOVERNMENT_ID', 'PROOF_OF_ADDRESS', 'TAX_DOCUMENT', 'BANK_PROOF', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierDocStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropIndex
DROP INDEX "Supplier_rcNumber_key";

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "companyType",
DROP COLUMN "dateOfRegistration",
DROP COLUMN "kycProvider",
DROP COLUMN "kycRawPayload",
DROP COLUMN "kycRegistrationStatus",
DROP COLUMN "ownerVerified",
DROP COLUMN "proprietorBvnMasked",
DROP COLUMN "rcNumber",
DROP COLUMN "shareCapital",
DROP COLUMN "shareDetails",
ADD COLUMN     "kycRejectedAt" TIMESTAMP(3),
ADD COLUMN     "kycRejectionReason" TEXT,
ADD COLUMN     "registeredBusinessName" TEXT,
ADD COLUMN     "registrationCountryCode" TEXT,
ADD COLUMN     "registrationDate" TIMESTAMP(3),
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "registrationType" TEXT,
ADD COLUMN     "registryAuthorityId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_VERIFICATION',
ALTER COLUMN "kycStatus" SET DEFAULT 'PENDING';

-- DropTable
DROP TABLE "CacLookup";

-- DropTable
DROP TABLE "CacRegistrationCache";

-- DropTable
DROP TABLE "CacVerificationTicket";

-- DropTable
DROP TABLE "CacVerifyAttempt";

-- DropEnum
DROP TYPE "CacOutcome";

-- DropEnum
DROP TYPE "CacStatus";

-- DropEnum
DROP TYPE "SupplierCompanyType";

-- CreateTable
CREATE TABLE "SupplierDocument" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "SupplierDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "status" "SupplierDocStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,

    CONSTRAINT "SupplierDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryAuthority" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierDocument_supplierId_kind_idx" ON "SupplierDocument"("supplierId", "kind");

-- CreateIndex
CREATE INDEX "SupplierDocument_supplierId_status_idx" ON "SupplierDocument"("supplierId", "status");

-- CreateIndex
CREATE INDEX "RegistryAuthority_countryCode_isActive_idx" ON "RegistryAuthority"("countryCode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryAuthority_countryCode_code_key" ON "RegistryAuthority"("countryCode", "code");

-- CreateIndex
CREATE INDEX "Supplier_registeredAddressId_idx" ON "Supplier"("registeredAddressId");

-- CreateIndex
CREATE INDEX "Supplier_registrationNumber_idx" ON "Supplier"("registrationNumber");

-- CreateIndex
CREATE INDEX "Supplier_registrationCountryCode_idx" ON "Supplier"("registrationCountryCode");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_registryAuthorityId_fkey" FOREIGN KEY ("registryAuthorityId") REFERENCES "RegistryAuthority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDocument" ADD CONSTRAINT "SupplierDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
