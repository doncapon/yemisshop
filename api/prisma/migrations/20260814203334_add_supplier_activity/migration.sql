-- CreateTable
CREATE TABLE "SupplierActivity" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierActivity_supplierId_createdAt_idx" ON "SupplierActivity"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierActivity_type_createdAt_idx" ON "SupplierActivity"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierActivity" ADD CONSTRAINT "SupplierActivity_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
