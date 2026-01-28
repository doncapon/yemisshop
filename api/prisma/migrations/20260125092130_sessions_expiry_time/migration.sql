-- AlterTable
ALTER TABLE "UserSession" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "rotatedAt" TIMESTAMP(3);
