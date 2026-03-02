-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('NEW', 'REVIEWED', 'SHORTLISTED', 'REJECTED');

-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" "JobApplicationStatus" NOT NULL DEFAULT 'NEW';

-- CreateIndex
CREATE INDEX "JobApplication_roleId_createdAt_idx" ON "JobApplication"("roleId", "createdAt");
