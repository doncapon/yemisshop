-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('PHYSICAL', 'ONLINE');

-- CreateEnum
CREATE TYPE "SupplierCompanyType" AS ENUM ('BUSINESS_NAME', 'COMPANY', 'INCORPORATED_TRUSTEES', 'LIMITED_PARTNERSHIP', 'LIMITED_LIABILITY_PARTNERSHIP');

-- CreateEnum
CREATE TYPE "CacStatus" AS ENUM ('NONE', 'CHECKED', 'APPROVED', 'REJECTED', 'PENDING');

-- CreateEnum
CREATE TYPE "CacOutcome" AS ENUM ('OK', 'NOT_FOUND', 'ERROR');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "CatalogRequestType" AS ENUM ('BRAND', 'CATEGORY', 'ATTRIBUTE', 'ATTRIBUTE_VALUE');

-- CreateEnum
CREATE TYPE "CatalogRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductPriceMode" AS ENUM ('AUTO', 'ADMIN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('CREATED', 'FUNDED', 'PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "houseNumber" TEXT,
    "streetName" TEXT,
    "postCode" TEXT,
    "town" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "lga" TEXT,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "addressId" TEXT,
    "shippingAddressId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "phoneOtpHash" TEXT,
    "phoneOtpExpiresAt" TIMESTAMP(3),
    "phoneOtpLastSentAt" TIMESTAMP(3),
    "phoneOtpSendCountDay" INTEGER NOT NULL DEFAULT 0,
    "emailVerifyToken" TEXT,
    "emailVerifyTokenExpiresAt" TIMESTAMP(3),
    "emailVerifyLastSentAt" TIMESTAMP(3),
    "emailVerifySendCountDay" INTEGER NOT NULL DEFAULT 0,
    "resetPasswordToken" TEXT,
    "resetPasswordExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "whatsappPhone" TEXT,
    "type" "SupplierType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "apiBaseUrl" TEXT,
    "apiAuthType" TEXT,
    "apiKey" TEXT,
    "userId" TEXT,
    "payoutMethod" TEXT,
    "bankCountry" TEXT,
    "bankCode" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "paystackRecipientCode" TEXT,
    "paystackSubaccountCode" TEXT,
    "isPayoutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyType" "SupplierCompanyType",
    "dateOfRegistration" TIMESTAMP(3),
    "kycRawPayload" JSONB,
    "legalName" TEXT,
    "natureOfBusiness" TEXT,
    "ownerVerified" BOOLEAN NOT NULL DEFAULT false,
    "proprietorBvnMasked" TEXT,
    "rcNumber" TEXT,
    "registeredAddressId" TEXT,
    "shareCapital" DECIMAL(65,30),
    "shareDetails" JSONB,
    "kycApprovedAt" TIMESTAMP(3),
    "kycCheckedAt" TIMESTAMP(3),
    "kycProvider" TEXT,
    "kycStatus" TEXT NOT NULL DEFAULT 'NONE',
    "kycRegistrationStatus" "CacStatus" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CacRegistrationCache" (
    "id" TEXT NOT NULL,
    "rcNumber" TEXT NOT NULL,
    "companyType" "SupplierCompanyType" NOT NULL,
    "entity" JSONB NOT NULL,
    "status" "CacStatus" NOT NULL DEFAULT 'CHECKED',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacRegistrationCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CacLookup" (
    "id" TEXT NOT NULL,
    "rcNumber" TEXT NOT NULL,
    "companyType" "SupplierCompanyType" NOT NULL,
    "outcome" "CacOutcome" NOT NULL,
    "entity" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CacVerificationTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "rcNumber" TEXT NOT NULL,
    "companyType" "SupplierCompanyType" NOT NULL,
    "companyNameNorm" TEXT NOT NULL,
    "regDateYMD" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "CacVerificationTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CacVerifyAttempt" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "rcNumber" TEXT NOT NULL,
    "companyType" "SupplierCompanyType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CacVerifyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shippingAddressId" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "tax" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "shippingBreakdownJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceFeeBase" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "serviceFeeComms" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "serviceFeeGateway" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "serviceFeeTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "serviceFee" DECIMAL(12,2),
    "billingAddressId" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(10,2),
    "status" TEXT,
    "selectedOptions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chosenSupplierId" TEXT,
    "chosenSupplierUnitPrice" DECIMAL(10,2),
    "weightGrams" INTEGER,
    "chosenSupplierProductOfferId" TEXT,
    "chosenSupplierVariantOfferId" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "channel" TEXT,
    "attemptNo" INTEGER,
    "initPayload" JSONB,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "feeAmount" DECIMAL(12,2) DEFAULT 0,
    "receiptNo" TEXT,
    "receiptIssuedAt" TIMESTAMP(3),
    "receiptData" JSONB,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "supplierBreakdownJson" JSONB,
    "supplierId" TEXT,
    "supplierName" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attribute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SELECT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Attribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeValue" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAttributeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(10,2),
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "imagesJson" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantOption" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,
    "priceBump" DECIMAL(65,30),

    CONSTRAINT "ProductVariantOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(10,2),
    "sku" TEXT NOT NULL,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "imagesJson" TEXT[],
    "userId" TEXT,
    "brandId" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "communicationCost" DECIMAL(10,2),
    "supplierTypeOverride" "SupplierType",
    "commissionPctInt" INTEGER,
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT,
    "autoPrice" DECIMAL(10,2),
    "priceMode" "ProductPriceMode" NOT NULL DEFAULT 'AUTO',
    "createdById" TEXT,
    "supplierId" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProductOffer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "leadDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierVariantOffer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "supplierProductOfferId" TEXT,
    "priceBump" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "leadDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierVariantOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "supplierNameSnapshot" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierOrderRef" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "platformFee" DECIMAL(10,2) NOT NULL,
    "supplierAmount" DECIMAL(10,2) NOT NULL,
    "whatsappMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'CREATED',

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "externalRef" TEXT,
    "externalStatus" TEXT,
    "receiptUrl" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderActivity" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wishlist" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateTable
CREATE TABLE "Otp" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "identifier" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerifyToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerifyToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeText" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAttributeText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderComms" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "supplierId" TEXT,
    "channel" TEXT,
    "recipient" TEXT,
    "units" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderComms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "type" "CouponType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "maxDiscount" DECIMAL(12,2),
    "minSubtotal" DECIMAL(12,2),
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCoupon" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemProfit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "revenue" DECIMAL(65,30) NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "chosenSupplierUnitPrice" DECIMAL(65,30) NOT NULL,
    "cogs" DECIMAL(65,30) NOT NULL,
    "allocatedGatewayFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "allocatedCommsFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "allocatedBaseServiceFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "profit" DECIMAL(65,30) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemProfit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogRequest" (
    "id" TEXT NOT NULL,
    "type" "CatalogRequestType" NOT NULL,
    "status" "CatalogRequestStatus" NOT NULL DEFAULT 'PENDING',
    "supplierId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "adminNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_addressId_key" ON "User"("addressId");

-- CreateIndex
CREATE UNIQUE INDEX "User_shippingAddressId_key" ON "User"("shippingAddressId");

-- CreateIndex
CREATE INDEX "User_emailVerifiedAt_idx" ON "User"("emailVerifiedAt");

-- CreateIndex
CREATE INDEX "User_phoneVerifiedAt_idx" ON "User"("phoneVerifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_userId_key" ON "Supplier"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_rcNumber_key" ON "Supplier"("rcNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CacRegistrationCache_rcNumber_companyType_key" ON "CacRegistrationCache"("rcNumber", "companyType");

-- CreateIndex
CREATE UNIQUE INDEX "CacLookup_rcNumber_companyType_key" ON "CacLookup"("rcNumber", "companyType");

-- CreateIndex
CREATE UNIQUE INDEX "CacVerificationTicket_tokenHash_key" ON "CacVerificationTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "CacVerificationTicket_rcNumber_companyType_idx" ON "CacVerificationTicket"("rcNumber", "companyType");

-- CreateIndex
CREATE INDEX "CacVerifyAttempt_ipHash_day_idx" ON "CacVerifyAttempt"("ipHash", "day");

-- CreateIndex
CREATE UNIQUE INDEX "CacVerifyAttempt_ipHash_day_rcNumber_companyType_key" ON "CacVerifyAttempt"("ipHash", "day", "rcNumber", "companyType");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_chosenSupplierId_idx" ON "OrderItem"("chosenSupplierId");

-- CreateIndex
CREATE INDEX "OrderItem_chosenSupplierProductOfferId_idx" ON "OrderItem"("chosenSupplierProductOfferId");

-- CreateIndex
CREATE INDEX "OrderItem_chosenSupplierVariantOfferId_idx" ON "OrderItem"("chosenSupplierVariantOfferId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");

-- CreateIndex
CREATE INDEX "Payment_supplierId_idx" ON "Payment"("supplierId");

-- CreateIndex
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "ProductAttributeOption_productId_idx" ON "ProductAttributeOption"("productId");

-- CreateIndex
CREATE INDEX "ProductAttributeOption_attributeId_idx" ON "ProductAttributeOption"("attributeId");

-- CreateIndex
CREATE INDEX "ProductAttributeOption_valueId_idx" ON "ProductAttributeOption"("valueId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeOption_productId_attributeId_valueId_key" ON "ProductAttributeOption"("productId", "attributeId", "valueId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_archivedAt_idx" ON "ProductVariant"("productId", "archivedAt");

-- CreateIndex
CREATE INDEX "ProductVariantOption_variantId_idx" ON "ProductVariantOption"("variantId");

-- CreateIndex
CREATE INDEX "ProductVariantOption_attributeId_idx" ON "ProductVariantOption"("attributeId");

-- CreateIndex
CREATE INDEX "ProductVariantOption_valueId_idx" ON "ProductVariantOption"("valueId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantOption_variantId_attributeId_valueId_key" ON "ProductVariantOption"("variantId", "attributeId", "valueId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_isDeleted_createdAt_idx" ON "Product"("isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "Product_userId_idx" ON "Product"("userId");

-- CreateIndex
CREATE INDEX "Product_ownerId_idx" ON "Product"("ownerId");

-- CreateIndex
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");

-- CreateIndex
CREATE INDEX "Product_createdById_idx" ON "Product"("createdById");

-- CreateIndex
CREATE INDEX "Product_updatedById_idx" ON "Product"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_isDeleted_key" ON "Product"("sku", "isDeleted");

-- CreateIndex
CREATE INDEX "SupplierProductOffer_productId_idx" ON "SupplierProductOffer"("productId");

-- CreateIndex
CREATE INDEX "SupplierProductOffer_supplierId_idx" ON "SupplierProductOffer"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierProductOffer_isActive_inStock_idx" ON "SupplierProductOffer"("isActive", "inStock");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductOffer_supplierId_productId_key" ON "SupplierProductOffer"("supplierId", "productId");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_variantId_idx" ON "SupplierVariantOffer"("variantId");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_productId_idx" ON "SupplierVariantOffer"("productId");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_supplierId_idx" ON "SupplierVariantOffer"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierVariantOffer_isActive_inStock_idx" ON "SupplierVariantOffer"("isActive", "inStock");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierVariantOffer_supplierId_variantId_key" ON "SupplierVariantOffer"("supplierId", "variantId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_paymentId_idx" ON "SupplierPaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_orderId_idx" ON "SupplierPaymentAllocation"("orderId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_supplierId_idx" ON "SupplierPaymentAllocation"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentAllocation_paymentId_supplierId_purchaseOrde_key" ON "SupplierPaymentAllocation"("paymentId", "supplierId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_supplierOrderRef_key" ON "PurchaseOrder"("supplierOrderRef");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orderId_idx" ON "PurchaseOrder"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderId_supplierId_key" ON "PurchaseOrder"("orderId", "supplierId");

-- CreateIndex
CREATE INDEX "OrderActivity_orderId_createdAt_idx" ON "OrderActivity"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderActivity_type_createdAt_idx" ON "OrderActivity"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- CreateIndex
CREATE INDEX "Favorite_productId_idx" ON "Favorite"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_productId_key" ON "Favorite"("userId", "productId");

-- CreateIndex
CREATE INDEX "Wishlist_userId_idx" ON "Wishlist"("userId");

-- CreateIndex
CREATE INDEX "Wishlist_productId_idx" ON "Wishlist"("productId");

-- CreateIndex
CREATE INDEX "Otp_identifier_createdAt_idx" ON "Otp"("identifier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerifyToken_token_key" ON "EmailVerifyToken"("token");

-- CreateIndex
CREATE INDEX "ProductAttributeText_productId_idx" ON "ProductAttributeText"("productId");

-- CreateIndex
CREATE INDEX "ProductAttributeText_attributeId_idx" ON "ProductAttributeText"("attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeText_productId_attributeId_key" ON "ProductAttributeText"("productId", "attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderComms_paymentId_key" ON "OrderComms"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCoupon_orderId_couponId_key" ON "OrderCoupon"("orderId", "couponId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemProfit_orderItemId_key" ON "OrderItemProfit"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemProfit_orderId_idx" ON "OrderItemProfit"("orderId");

-- CreateIndex
CREATE INDEX "CatalogRequest_status_type_idx" ON "CatalogRequest"("status", "type");

-- CreateIndex
CREATE INDEX "CatalogRequest_supplierId_createdAt_idx" ON "CatalogRequest"("supplierId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_registeredAddressId_fkey" FOREIGN KEY ("registeredAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_chosenSupplierId_fkey" FOREIGN KEY ("chosenSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_chosenSupplierProductOfferId_fkey" FOREIGN KEY ("chosenSupplierProductOfferId") REFERENCES "SupplierProductOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_chosenSupplierVariantOfferId_fkey" FOREIGN KEY ("chosenSupplierVariantOfferId") REFERENCES "SupplierVariantOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeValue" ADD CONSTRAINT "AttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeOption" ADD CONSTRAINT "ProductAttributeOption_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeOption" ADD CONSTRAINT "ProductAttributeOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeOption" ADD CONSTRAINT "ProductAttributeOption_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "AttributeValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOption" ADD CONSTRAINT "ProductVariantOption_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOption" ADD CONSTRAINT "ProductVariantOption_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "AttributeValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOption" ADD CONSTRAINT "ProductVariantOption_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductOffer" ADD CONSTRAINT "SupplierProductOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductOffer" ADD CONSTRAINT "SupplierProductOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierVariantOffer" ADD CONSTRAINT "SupplierVariantOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierVariantOffer" ADD CONSTRAINT "SupplierVariantOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierVariantOffer" ADD CONSTRAINT "SupplierVariantOffer_supplierProductOfferId_fkey" FOREIGN KEY ("supplierProductOfferId") REFERENCES "SupplierProductOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierVariantOffer" ADD CONSTRAINT "SupplierVariantOffer_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderActivity" ADD CONSTRAINT "OrderActivity_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerifyToken" ADD CONSTRAINT "EmailVerifyToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeText" ADD CONSTRAINT "ProductAttributeText_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeText" ADD CONSTRAINT "ProductAttributeText_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderComms" ADD CONSTRAINT "OrderComms_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderComms" ADD CONSTRAINT "OrderComms_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderComms" ADD CONSTRAINT "OrderComms_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCoupon" ADD CONSTRAINT "OrderCoupon_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCoupon" ADD CONSTRAINT "OrderCoupon_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemProfit" ADD CONSTRAINT "OrderItemProfit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemProfit" ADD CONSTRAINT "OrderItemProfit_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogRequest" ADD CONSTRAINT "CatalogRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogRequest" ADD CONSTRAINT "CatalogRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
