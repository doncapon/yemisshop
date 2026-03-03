-- CreateEnum
CREATE TYPE "CareersEmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERN');

-- CreateEnum
CREATE TYPE "CareersLocationType" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');

-- CreateTable
CREATE TABLE "CareersJobRole" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "location" TEXT,
    "locationType" "CareersLocationType",
    "employmentType" "CareersEmploymentType",
    "minSalary" INTEGER,
    "maxSalary" INTEGER,
    "currency" TEXT DEFAULT 'NGN',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "applicationEmail" TEXT,
    "applicationUrl" TEXT,
    "introHtml" TEXT,
    "responsibilitiesJson" JSONB,
    "requirementsJson" JSONB,
    "benefitsJson" JSONB,
    "closingDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareersJobRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareersSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "isCareersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowOpenApplications" BOOLEAN NOT NULL DEFAULT false,
    "careersEmail" TEXT,
    "careersInboxLabel" TEXT,
    "defaultLocation" TEXT,
    "defaultLocationType" "CareersLocationType",
    "careersIntroHtml" TEXT,
    "careersFooterHtml" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareersSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareersJobRole_slug_key" ON "CareersJobRole"("slug");
