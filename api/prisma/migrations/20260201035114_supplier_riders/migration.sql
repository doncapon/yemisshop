-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUPER_ADMIN', 'SHOPPER', 'SUPPLIER', 'SUPPLIER_RIDER');

-- CreateTable
CREATE TABLE "SupplierRider" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierRider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRider_userId_key" ON "SupplierRider"("userId");

-- CreateIndex
CREATE INDEX "SupplierRider_supplierId_idx" ON "SupplierRider"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierRider" ADD CONSTRAINT "SupplierRider_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRider" ADD CONSTRAINT "SupplierRider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
