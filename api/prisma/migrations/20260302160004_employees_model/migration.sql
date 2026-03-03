-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'PROBATION', 'ON_LEAVE', 'EXITED');

-- CreateEnum
CREATE TYPE "EmployeePayFrequency" AS ENUM ('MONTHLY', 'WEEKLY', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeDocumentKind" AS ENUM ('PASSPORT', 'NIN_SLIP', 'TAX', 'CONTRACT', 'OTHER');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "emailWork" TEXT,
    "emailPersonal" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "department" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "baseSalaryNGN" INTEGER,
    "payFrequency" "EmployeePayFrequency",
    "bankName" TEXT,
    "bankCode" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "isPayrollReady" BOOLEAN NOT NULL DEFAULT false,
    "hasPassportDoc" BOOLEAN NOT NULL DEFAULT false,
    "hasNinSlipDoc" BOOLEAN NOT NULL DEFAULT false,
    "hasTaxDoc" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employeeId" TEXT NOT NULL,
    "kind" "EmployeeDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "uploadedByUserId" TEXT,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employee_status_department_idx" ON "Employee"("status", "department");

-- CreateIndex
CREATE INDEX "Employee_emailWork_idx" ON "Employee"("emailWork");

-- CreateIndex
CREATE INDEX "Employee_emailPersonal_idx" ON "Employee"("emailPersonal");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_kind_idx" ON "EmployeeDocument"("employeeId", "kind");

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
