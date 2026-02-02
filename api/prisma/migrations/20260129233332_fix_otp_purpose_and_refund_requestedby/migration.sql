-- ===== Fix OrderOtpRequest.purpose cast safely =====

DO $$ BEGIN
  CREATE TYPE "OrderOtpPurpose" AS ENUM ('PAY_ORDER', 'CANCEL_ORDER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "OrderOtpRequest"
  ALTER COLUMN "purpose" TYPE "OrderOtpPurpose"
  USING (
    CASE
      WHEN UPPER("purpose"::text) IN ('PAY_ORDER','PAYMENT','PAY') THEN 'PAY_ORDER'::"OrderOtpPurpose"
      WHEN UPPER("purpose"::text) IN ('CANCEL_ORDER','CANCEL') THEN 'CANCEL_ORDER'::"OrderOtpPurpose"
      ELSE 'PAY_ORDER'::"OrderOtpPurpose"
    END
  );

-- ===== Add Refund.requestedByUserId safely (nullable -> backfill -> NOT NULL) =====

ALTER TABLE "Refund" ADD COLUMN "requestedByUserId" TEXT;

UPDATE "Refund" r
SET "requestedByUserId" = o."userId"
FROM "Order" o
WHERE o."id" = r."orderId"
  AND r."requestedByUserId" IS NULL;

UPDATE "Refund"
SET "requestedByUserId" = (
  SELECT id FROM "User"
  WHERE role IN ('ADMIN','SUPER_ADMIN')
  ORDER BY "createdAt" ASC
  LIMIT 1
)
WHERE "requestedByUserId" IS NULL;

ALTER TABLE "Refund"
  ALTER COLUMN "requestedByUserId" SET NOT NULL;

ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
