-- AlterTable: make password nullable and add googleId
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

-- CreateIndex: unique constraint on googleId
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
