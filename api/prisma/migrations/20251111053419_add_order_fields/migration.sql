/*
  Warnings:

  - You are about to drop the column `serviceFee` on the `Order` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "serviceFee",
ADD COLUMN     "serviceFeeBase" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "serviceFeeComms" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "serviceFeeGateway" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "serviceFeeTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;
