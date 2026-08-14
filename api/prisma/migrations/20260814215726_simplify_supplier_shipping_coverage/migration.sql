-- CreateEnum
CREATE TYPE "SupplierShippingCoverage" AS ENUM ('LOCAL', 'REGIONAL', 'NATIONWIDE');

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "shipsNationwide",
DROP COLUMN "supportsDoorDelivery",
DROP COLUMN "supportsPickupPoint",
ADD COLUMN     "shippingCoverage" "SupplierShippingCoverage" NOT NULL DEFAULT 'NATIONWIDE';

