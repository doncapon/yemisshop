/*
  Warnings:

  - You are about to drop the column `cvUrl` on the `JobApplication` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "JobApplication" DROP COLUMN "cvUrl",
ADD COLUMN     "cvFilename" TEXT,
ADD COLUMN     "cvMimeType" TEXT,
ADD COLUMN     "cvSize" INTEGER;
