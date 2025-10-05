-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifyLastSentAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifySendCountDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phoneOtpCode" TEXT,
ADD COLUMN     "phoneOtpLastSentAt" TIMESTAMP(3),
ADD COLUMN     "phoneOtpSendCountDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false;
