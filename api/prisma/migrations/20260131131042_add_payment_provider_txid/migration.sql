-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "providerEnv" VARCHAR(16),
ADD COLUMN     "providerMeta" JSONB,
ADD COLUMN     "providerTxId" VARCHAR(64);

-- CreateIndex
CREATE INDEX "Payment_provider_providerTxId_idx" ON "Payment"("provider", "providerTxId");
