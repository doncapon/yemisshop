// api/prisma/seed.ts
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "@prisma/client";
import { CATEGORY_TREE, seedCategoriesTree, type CatNode } from "./seedCategories.js";
const prisma = new PrismaClient();

/* ----------------------------------------------------------------------------
  Config (env)
---------------------------------------------------------------------------- */

const SUPER_EMAIL = process.env.SUPERADMIN_EMAIL || "superadmin@example.com";
const SUPER_PASS = process.env.SUPERADMIN_PASSWORD || "SuperAdmin123!";
const SUPER_FIRST = process.env.SUPERADMIN_FIRSTNAME || "Super";
const SUPER_LAST = process.env.SUPERADMIN_LASTNAME || "Admin";

const SUPPLIER_EMAIL = process.env.SEED_SUPPLIER_EMAIL || "supplier@example.com";
const SUPPLIER_PASS = process.env.SEED_SUPPLIER_PASSWORD || "Supplier123!";
const SUPPLIER_FIRST = process.env.SEED_SUPPLIER_FIRSTNAME || "Seed";
const SUPPLIER_LAST = process.env.SEED_SUPPLIER_LASTNAME || "Supplier";

/** requirements */
const LIVE_PRODUCTS_TOTAL = 80;
const PENDING_PRODUCTS_TOTAL = 10;

// Variant mix
const LIVE_VARIANT_FRACTION = 0.35;
const PENDING_VARIANT_FRACTION = 0.34;

// Inventory
const MIN_AVAILABLE = 10;
const MAX_AVAILABLE = 40;

// Brands per "base product title"
const MIN_BRANDS_PER_BASE = 2;
const MAX_BRANDS_PER_BASE = 4;

const log = (...a: any[]) => console.log("[seed]", ...a);
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p: number) => Math.random() < p;

function pics(seed: string | number): string[] {
  return [
    `https://picsum.photos/seed/dayspring-${seed}/800/600`,
    `https://picsum.photos/seed/dayspring-${seed}-b/800/600`,
  ];
}

type SeedBankOption = {
  country: "NG";
  code: string;
  name: string;
};

const SEED_BANKS: SeedBankOption[] = [
  { country: "NG", code: "011", name: "First Bank of Nigeria" },
  { country: "NG", code: "033", name: "United Bank for Africa" },
  { country: "NG", code: "044", name: "Access Bank" },
  { country: "NG", code: "057", name: "Zenith Bank" },
  { country: "NG", code: "058", name: "Guaranty Trust Bank" },
  { country: "NG", code: "070", name: "Fidelity Bank" },
  { country: "NG", code: "076", name: "Polaris Bank" },
  { country: "NG", code: "214", name: "FCMB" },
  { country: "NG", code: "215", name: "Unity Bank" },
  { country: "NG", code: "221", name: "Stanbic IBTC Bank" },
  { country: "NG", code: "232", name: "Sterling Bank" },
  { country: "NG", code: "035", name: "Wema Bank" },
];

/** keep seed deterministic */
function seededAccountNumber(n: number) {
  return `10000000${String(n).padStart(2, "0")}`; // 10 digits
}

function seededRegistrationNumber(n: number) {
  return `RC-${String(1000000 + n)}`;
}

function seededSupplierBank(index: number) {
  return SEED_BANKS[index % SEED_BANKS.length];
}

async function ensureRegistryAuthorityNigeria() {
  const ra = await prisma.registryAuthority.upsert({
    where: {
      countryCode_code: {
        countryCode: "NG",
        code: "CAC",
      },
    },
    update: {
      name: "Corporate Affairs Commission",
      websiteUrl: "https://www.cac.gov.ng",
      isActive: true,
    },
    create: {
      countryCode: "NG",
      code: "CAC",
      name: "Corporate Affairs Commission",
      websiteUrl: "https://www.cac.gov.ng",
      isActive: true,
    },
    select: { id: true },
  });

  return ra.id;
}

function activeSupplierPayload(args: {
  name: string;
  type: "ONLINE" | "PHYSICAL";
  contactEmail: string;
  whatsappPhone: string;
  registeredAddressId: string;
  pickupAddressId: string;
  pickupContactName: string;
  pickupContactPhone: string;
  pickupInstructions: string;
  leadDays: number;
  handlingFee: number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  registryAuthorityId: string;
  registrationNumber: string;
  legalName?: string;
}) {
  const now = new Date();

  return {
    type: args.type,
    status: "ACTIVE",
    contactEmail: args.contactEmail,
    whatsappPhone: args.whatsappPhone,

    legalName: args.legalName ?? args.name,
    registeredBusinessName: args.name,
    registrationType: "REGISTERED_BUSINESS",
    registrationNumber: args.registrationNumber,
    registrationDate: new Date("2024-01-15T00:00:00.000Z"),
    registrationCountryCode: "NG",
    registryAuthorityId: args.registryAuthorityId,
    natureOfBusiness: "Retail and wholesale supply",

    registeredAddressId: args.registeredAddressId,
    pickupAddressId: args.pickupAddressId,

    kycStatus: "APPROVED",
    kycApprovedAt: now,
    kycCheckedAt: now,
    kycRejectedAt: null,
    kycRejectionReason: null,

    payoutMethod: "BANK_TRANSFER",
    bankCountry: "NG",
    bankCode: args.bankCode,
    bankName: args.bankName,
    accountNumber: args.accountNumber,
    accountName: args.accountName,

    bankVerificationNote: "Seeded local/dev supplier bank details",
    bankVerificationRequestedAt: now,
    bankVerificationStatus: "VERIFIED" as const,
    bankVerifiedAt: now,

    isPayoutEnabled: true,

    pickupContactName: args.pickupContactName,
    pickupContactPhone: args.pickupContactPhone,
    pickupInstructions: args.pickupInstructions,
    shippingEnabled: true,
    shipsNationwide: true,
    defaultLeadDays: args.leadDays,
    sameDayCutoffHour: 14,
    handlingFee: toDec2(args.handlingFee),
    supportsDoorDelivery: true,
    supportsPickupPoint: chance(0.35),
  };
}


function toDec(n: number) {
  return new Prisma.Decimal(Math.round(n * 100) / 100);
}

function toDec2(n: number) {
  return new Prisma.Decimal(Math.round(n * 100) / 100);
}

function pick<T>(arr: T[], n: number) {
  const copy = [...arr];
  copy.sort(() => Math.random() - 0.5);
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

function uniqSlugBase(s: string) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

/**
 * Supplier-level uniqueness for "base products":
 * one supplier should not get duplicate occurrences of the same (title + brandId)
 */
function productKeyForSupplier(title: string, brandId: string) {
  return `${uniqSlugBase(title)}::${String(brandId)}`;
}

function pickSupplierForItem(
  suppliers: { id: string }[],
  usedBySupplier: Map<string, Set<string>>,
  title: string,
  brandId: string
) {
  const key = productKeyForSupplier(title, brandId);

  const shuffled = [...suppliers].sort(() => Math.random() - 0.5);
  for (const s of shuffled) {
    const set = usedBySupplier.get(s.id) ?? new Set<string>();
    if (!set.has(key)) return s.id;
  }

  return suppliers[randInt(0, suppliers.length - 1)].id;
}

/* ----------------------------------------------------------------------------
  Core bootstrap
---------------------------------------------------------------------------- */
async function ensureCoreSettings() {
  try {
    await prisma.setting.createMany({
      data: [
        { key: "taxMode", value: "INCLUDED", isPublic: true },
        { key: "taxRatePct", value: "7.5", isPublic: true },
        { key: "commsUnitCostNGN", value: "100", isPublic: false },
        { key: "profitMode", value: "accurate", isPublic: false },
        { key: "serviceFeeBaseNGN", value: "1000", isPublic: false },
        { key: "platformBaseFeeNGN", value: "100", isPublic: false },
        { key: "marginPercent", value: "10", isPublic: true },
        { key: "minMarginNGN", value: "500", isPublic: true },
        { key: "maxMarginPct", value: "100", isPublic: true },
      ],
      skipDuplicates: true,
    });
    log("Core settings ensured.");
  } catch {
    log("Skipping settings (table may not exist yet).");
  }
}

async function ensureSuperAdmin() {
  log("Ensuring Super Admin exists…");

  const existing = await prisma.user.findUnique({
    where: { email: SUPER_EMAIL },
    select: { id: true, role: true },
  });

  if (existing) {
    if (existing.role !== "SUPER_ADMIN") {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: "SUPER_ADMIN",
          status: "VERIFIED",
          emailVerifiedAt: new Date(),
        },
      });
      log(`Upgraded existing user to SUPER_ADMIN: ${SUPER_EMAIL}`);
    } else {
      log(`Super Admin already present: ${SUPER_EMAIL}`);
    }
    return existing.id;
  }

  const passwordHash = await bcrypt.hash(SUPER_PASS, 10);

  const address = await prisma.address.create({
    data: {
      houseNumber: "1",
      streetName: "Leadership Ave",
      city: "Abuja",
      state: "FCT",
      lga: "Abuja Municipal",
      postCode: "900001",
      town: "Wuse",
      country: "Nigeria",
      isValidated: true,
      validationSource: "seed",
      validatedAt: new Date(),
    },
  });

  const user = await prisma.user.create({
    data: {
      email: SUPER_EMAIL,
      password: passwordHash,
      role: "SUPER_ADMIN",
      firstName: SUPER_FIRST,
      lastName: SUPER_LAST,
      phone: "+2348100000001",
      status: "VERIFIED",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      joinedAt: new Date(),
      address: { connect: { id: address.id } },
      shippingAddress: { connect: { id: address.id } },
    },
    select: { id: true },
  });

  log(`Created Super Admin: ${SUPER_EMAIL}`);
  return user.id;
}

/* ----------------------------------------------------------------------------
  Supplier user + suppliers
---------------------------------------------------------------------------- */
async function ensureSupplierUserAndSuppliers() {
  log("Ensuring Supplier user + Suppliers exist…");

  const existingUser = await prisma.user.findUnique({
    where: { email: SUPPLIER_EMAIL },
    select: { id: true },
  });

  let userId: string;

  if (!existingUser) {
    const passwordHash = await bcrypt.hash(SUPPLIER_PASS, 10);
    const address = await prisma.address.create({
      data: {
        houseNumber: "12",
        streetName: "Supplier Road",
        city: "Lagos",
        state: "Lagos",
        lga: "Ikeja",
        town: "Ikeja",
        postCode: "100271",
        country: "Nigeria",
        isValidated: true,
        validationSource: "seed",
        validatedAt: new Date(),
      },
    });

    const created = await prisma.user.create({
      data: {
        email: SUPPLIER_EMAIL,
        password: passwordHash,
        role: "SUPPLIER",
        firstName: SUPPLIER_FIRST,
        lastName: SUPPLIER_LAST,
        phone: "+2348100000002",
        status: "VERIFIED",
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        joinedAt: new Date(),
        address: { connect: { id: address.id } },
        shippingAddress: { connect: { id: address.id } },
      },
      select: { id: true },
    });

    userId = created.id;
    log(`Created Supplier user: ${SUPPLIER_EMAIL}`);
  } else {
    userId = existingUser.id;

    await prisma.user.update({
      where: { id: userId },
      data: {
        role: "SUPPLIER",
        status: "VERIFIED",
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });

    log(`Supplier user already present: ${SUPPLIER_EMAIL}`);
  }

  const registryAuthorityId = await ensureRegistryAuthorityNigeria();

  const makeSupplierAddresses = async (
    seedName: string,
    state: string,
    city: string,
    lga: string
  ) => {
    const reg = await prisma.address.create({
      data: {
        houseNumber: String(randInt(2, 55)),
        streetName: `${seedName} Registered St`,
        city,
        state,
        lga,
        town: lga,
        postCode: `${randInt(100000, 999999)}`,
        country: "Nigeria",
        isValidated: true,
        validationSource: "seed",
        validatedAt: new Date(),
      },
    });

    const pickup = await prisma.address.create({
      data: {
        houseNumber: String(randInt(1, 40)),
        streetName: `${seedName} Pickup Hub`,
        city,
        state,
        lga,
        town: lga,
        postCode: `${randInt(100000, 999999)}`,
        country: "Nigeria",
        landmark: "Near main junction",
        directionsNote: "Call pickup contact before arrival",
        isValidated: true,
        validationSource: "seed",
        validatedAt: new Date(),
      },
    });

    return { reg, pickup };
  };

  const mainName = "Main Household Supplier";
  const mainAddrs = await makeSupplierAddresses(mainName, "Lagos", "Lagos", "Ikeja");
  const mainBank = seededSupplierBank(0);

  const mainSupplier = await prisma.supplier.upsert({
    where: { name: mainName },
    update: {
      userId,
      ...activeSupplierPayload({
        name: mainName,
        type: "ONLINE",
        contactEmail: SUPPLIER_EMAIL,
        whatsappPhone: "+2348100000002",
        registeredAddressId: mainAddrs.reg.id,
        pickupAddressId: mainAddrs.pickup.id,
        pickupContactName: "Main Dispatch",
        pickupContactPhone: "+2348100000002",
        pickupInstructions: "Pickup between 9am and 5pm",
        leadDays: 2,
        handlingFee: 80,
        bankCode: mainBank.code,
        bankName: mainBank.name,
        accountNumber: seededAccountNumber(1),
        accountName: "Main Household Supplier",
        registryAuthorityId,
        registrationNumber: seededRegistrationNumber(1),
      }),
    },
    create: {
      name: mainName,
      userId,
      ...activeSupplierPayload({
        name: mainName,
        type: "ONLINE",
        contactEmail: SUPPLIER_EMAIL,
        whatsappPhone: "+2348100000002",
        registeredAddressId: mainAddrs.reg.id,
        pickupAddressId: mainAddrs.pickup.id,
        pickupContactName: "Main Dispatch",
        pickupContactPhone: "+2348100000002",
        pickupInstructions: "Pickup between 9am and 5pm",
        leadDays: 2,
        handlingFee: 80,
        bankCode: mainBank.code,
        bankName: mainBank.name,
        accountNumber: seededAccountNumber(1),
        accountName: "Main Household Supplier",
        registryAuthorityId,
        registrationNumber: seededRegistrationNumber(1),
      }),
    },
    select: { id: true, name: true },
  });

  const otherDefs = [
    {
      name: "City Electronics Hub",
      state: "Lagos",
      city: "Lagos",
      lga: "Surulere",
      type: "PHYSICAL" as const,
      bankIdx: 1,
    },
    {
      name: "Comfort Home Store",
      state: "Oyo",
      city: "Ibadan",
      lga: "Ibadan North",
      type: "ONLINE" as const,
      bankIdx: 2,
    },
    {
      name: "Rivers Kitchen Outlet",
      state: "Rivers",
      city: "Port Harcourt",
      lga: "Port Harcourt",
      type: "PHYSICAL" as const,
      bankIdx: 3,
    },
    {
      name: "Abuja Essentials",
      state: "FCT",
      city: "Abuja",
      lga: "Abuja Municipal",
      type: "ONLINE" as const,
      bankIdx: 4,
    },
  ];

  const others: { id: string; name: string }[] = [];

  for (const [i, def] of otherDefs.entries()) {
    const addrs = await makeSupplierAddresses(def.name, def.state, def.city, def.lga);
    const bank = seededSupplierBank(def.bankIdx);

    const emailSlug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const phone = `+23481${randInt(0, 9)}${randInt(10000000, 99999999)}`;

    const s = await prisma.supplier.upsert({
      where: { name: def.name },
      update: {
        ...activeSupplierPayload({
          name: def.name,
          type: def.type,
          contactEmail: `${emailSlug}@example.com`,
          whatsappPhone: phone,
          registeredAddressId: addrs.reg.id,
          pickupAddressId: addrs.pickup.id,
          pickupContactName: `${def.name} Dispatch`,
          pickupContactPhone: phone,
          pickupInstructions: "Pickup weekdays 9am–4pm",
          leadDays: randInt(1, 4),
          handlingFee: randInt(0, 150),
          bankCode: bank.code,
          bankName: bank.name,
          accountNumber: seededAccountNumber(i + 2),
          accountName: def.name,
          registryAuthorityId,
          registrationNumber: seededRegistrationNumber(i + 2),
        }),
      },
      create: {
        name: def.name,
        ...activeSupplierPayload({
          name: def.name,
          type: def.type,
          contactEmail: `${emailSlug}@example.com`,
          whatsappPhone: phone,
          registeredAddressId: addrs.reg.id,
          pickupAddressId: addrs.pickup.id,
          pickupContactName: `${def.name} Dispatch`,
          pickupContactPhone: phone,
          pickupInstructions: "Pickup weekdays 9am–4pm",
          leadDays: randInt(1, 4),
          handlingFee: randInt(0, 150),
          bankCode: bank.code,
          bankName: bank.name,
          accountNumber: seededAccountNumber(i + 2),
          accountName: def.name,
          registryAuthorityId,
          registrationNumber: seededRegistrationNumber(i + 2),
        }),
      },
      select: { id: true, name: true },
    });

    others.push(s);
  }

  log(`Suppliers ensured: ${1 + others.length}`);
  return {
    suppliers: [mainSupplier, ...others],
    mainSupplier,
    supplierUserId: userId,
  };
}

/* ----------------------------------------------------------------------------
  Categories + brands
---------------------------------------------------------------------------- */
function flattenLeafCategoryNames(nodes: CatNode[]): string[] {
  const out: string[] = [];

  const walk = (items: CatNode[]) => {
    for (const node of items) {
      if (node.children?.length) {
        walk(node.children);
      } else {
        out.push(node.name);
      }
    }
  };

  walk(nodes);
  return [...new Set(out)];
}

async function ensureCategoriesFromTree() {
  await seedCategoriesTree(prisma);

  const leafNames = flattenLeafCategoryNames(CATEGORY_TREE);

  const categories = await prisma.category.findMany({
    where: {
      name: { in: leafNames },
      isActive: true,
    },
    select: { id: true, name: true },
  });

  if (!categories.length) {
    throw new Error("No categories found after seeding category tree.");
  }

  log(`Categories ensured from tree: ${categories.length} leaf categories`);
  return categories;
}

async function ensureBrands() {
  const names = [
    "BrightHome",
    "Urban Living",
    "KitchenPro",
    "SoundWave",
    "ComfortWear",
    "Daily Essentials",
    "SmartHouse",
    "FreshStart",
    "PrimeTech",
    "CozyCorner",
  ];

  const out: { id: string; name: string; slug: string }[] = [];
  for (const n of names) {
    const slug = uniqSlugBase(n);
    const b = await prisma.brand.upsert({
      where: { slug },
      update: { isActive: true, name: n },
      create: {
        name: n,
        slug,
        logoUrl: `https://picsum.photos/seed/${slug}/160/160`,
        isActive: true,
      },
      select: { id: true, name: true, slug: true },
    });
    out.push(b);
  }
  return out;
}

/* ----------------------------------------------------------------------------
  Attributes
---------------------------------------------------------------------------- */
type SeedAttr = {
  name: string;
  type?: string;
  values: { name: string; code?: string }[];
};

async function ensureAttributes() {
  const attrs: SeedAttr[] = [
    {
      name: "Color",
      type: "SELECT",
      values: [
        { name: "Red", code: "RED" },
        { name: "Blue", code: "BLUE" },
        { name: "Black", code: "BLACK" },
      ],
    },
    {
      name: "Size",
      type: "SELECT",
      values: [
        { name: "S", code: "S" },
        { name: "M", code: "M" },
        { name: "L", code: "L" },
      ],
    },
  ];

  const out: {
    attributeId: string;
    name: string;
    values: { id: string; name: string; code?: string | null }[];
  }[] = [];

  for (const a of attrs) {
    let attr = await prisma.attribute.findFirst({
      where: { name: a.name },
      select: { id: true, name: true },
    });

    if (!attr) {
      attr = await prisma.attribute.create({
        data: { name: a.name, type: a.type ?? "SELECT", isActive: true },
        select: { id: true, name: true },
      });
    } else {
      await prisma.attribute.update({
        where: { id: attr.id },
        data: { isActive: true, type: a.type ?? "SELECT" },
      });
    }

    const vals: { id: string; name: string; code?: string | null }[] = [];
    for (const [pos, v] of a.values.entries()) {
      const existingVal = await prisma.attributeValue.findFirst({
        where: { attributeId: attr.id, name: v.name },
        select: { id: true, name: true, code: true },
      });

      if (existingVal) {
        const updated = await prisma.attributeValue.update({
          where: { id: existingVal.id },
          data: {
            code: v.code ?? existingVal.code ?? null,
            position: pos,
            isActive: true,
          },
          select: { id: true, name: true, code: true },
        });
        vals.push(updated);
      } else {
        const created = await prisma.attributeValue.create({
          data: {
            attributeId: attr.id,
            name: v.name,
            code: v.code ?? null,
            position: pos,
            isActive: true,
          },
          select: { id: true, name: true, code: true },
        });
        vals.push(created);
      }
    }

    out.push({ attributeId: attr.id, name: attr.name, values: vals });
  }

  log(`Attributes ensured: ${out.length}`);
  return out;
}

async function ensureProductAttributeOptions(
  productId: string,
  attrs: Awaited<ReturnType<typeof ensureAttributes>>
) {
  for (const a of attrs) {
    await prisma.productAttribute.upsert({
      where: {
        productId_attributeId: {
          productId,
          attributeId: a.attributeId,
        },
      },
      update: {},
      create: {
        productId,
        attributeId: a.attributeId,
      },
    });

    for (const v of a.values) {
      try {
        await prisma.productAttributeOption.create({
          data: { productId, attributeId: a.attributeId, valueId: v.id },
        });
      } catch {
        // ignore dupes from re-seeding
      }
    }
  }
}

/* ----------------------------------------------------------------------------
  Shipping parcel helpers
---------------------------------------------------------------------------- */
type ParcelSeed = {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isFragile: boolean;
  isBulky: boolean;
  shippingClass: "STANDARD" | "FRAGILE" | "BULKY";
};

function parcelForTitle(title: string): ParcelSeed {
  const t = title.toLowerCase();

  if (t.includes("kettle")) {
    return {
      weightGrams: randInt(1200, 2200),
      lengthCm: randInt(20, 28),
      widthCm: randInt(18, 24),
      heightCm: randInt(20, 30),
      isFragile: true,
      isBulky: false,
      shippingClass: "FRAGILE",
    };
  }

  if (
    t.includes("speaker") ||
    t.includes("blender") ||
    t.includes("toaster") ||
    t.includes("fan")
  ) {
    return {
      weightGrams: randInt(1500, 4000),
      lengthCm: randInt(22, 40),
      widthCm: randInt(18, 32),
      heightCm: randInt(18, 45),
      isFragile: true,
      isBulky: chance(0.35),
      shippingClass: chance(0.35) ? "BULKY" : "FRAGILE",
    };
  }

  if (t.includes("sneakers") || t.includes("backpack")) {
    return {
      weightGrams: randInt(700, 1800),
      lengthCm: randInt(25, 40),
      widthCm: randInt(18, 28),
      heightCm: randInt(12, 24),
      isFragile: false,
      isBulky: false,
      shippingClass: "STANDARD",
    };
  }

  if (
    t.includes("headphones") ||
    t.includes("mouse") ||
    t.includes("keyboard") ||
    t.includes("router")
  ) {
    return {
      weightGrams: randInt(250, 1500),
      lengthCm: randInt(14, 46),
      widthCm: randInt(10, 18),
      heightCm: randInt(4, 12),
      isFragile: chance(0.25),
      isBulky: false,
      shippingClass: chance(0.25) ? "FRAGILE" : "STANDARD",
    };
  }

  if (t.includes("mug") || t.includes("lamp")) {
    return {
      weightGrams: randInt(350, 1400),
      lengthCm: randInt(12, 30),
      widthCm: randInt(12, 25),
      heightCm: randInt(12, 35),
      isFragile: true,
      isBulky: false,
      shippingClass: "FRAGILE",
    };
  }

  return {
    weightGrams: randInt(200, 1200),
    lengthCm: randInt(10, 30),
    widthCm: randInt(8, 24),
    heightCm: randInt(3, 18),
    isFragile: false,
    isBulky: false,
    shippingClass: "STANDARD",
  };
}

function variantParcelOverride(base: ParcelSeed) {
  const w = Math.max(100, base.weightGrams + randInt(-120, 220));
  const l = Math.max(5, base.lengthCm + randInt(-2, 3));
  const wd = Math.max(5, base.widthCm + randInt(-2, 3));
  const h = Math.max(2, base.heightCm + randInt(-2, 3));

  return {
    weightGrams: w,
    lengthCm: toDec2(l),
    widthCm: toDec2(wd),
    heightCm: toDec2(h),
    isFragileOverride: base.isFragile || chance(0.05),
    isBulkyOverride: base.isBulky || chance(0.05),
    shippingClassOverride: (base.isBulky
      ? "BULKY"
      : base.isFragile
        ? "FRAGILE"
        : "STANDARD") as string,
  };
}

/* ----------------------------------------------------------------------------
  Variants creation
---------------------------------------------------------------------------- */
async function createVariantsForProduct(args: {
  productId: string;
  skuBase: string;
  retail: number;
  attrs: Awaited<ReturnType<typeof ensureAttributes>>;
  productParcel: ParcelSeed;
}) {
  const { productId, skuBase, retail, attrs } = args;

  const attrByName = new Map(attrs.map((a) => [a.name, a]));
  const color = attrByName.get("Color");
  const size = attrByName.get("Size");

  if (!color || !size) return [];

  const values1 = color.values.slice(0, 3);
  const values2 = size.values.slice(0, 3);

  const combos: Array<{ c: string; s: string }> = [];
  for (const c of values1) {
    for (const s of values2) {
      combos.push({ c: c.id, s: s.id });
    }
  }

  const want = randInt(3, 6);
  const chosen = pick(combos, want);

  const seen = new Set<string>();
  const chosenUnique = chosen.filter((x) => {
    const k = `${x.c}:${x.s}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const createdVariants: {
    id: string;
    sku: string | null;
    retailPrice: Prisma.Decimal | null;
  }[] = [];

  let idx = 1;
  for (const combo of chosenUnique) {
    const vSku = `${skuBase}-V${String(idx).padStart(2, "0")}`;
    idx++;

    const variantRetail = Math.max(900, retail + randInt(-100, 1200));
    const override = variantParcelOverride(args.productParcel);

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        sku: vSku,
        retailPrice: toDec(variantRetail),
        weightGrams: override.weightGrams,
        lengthCm: override.lengthCm,
        widthCm: override.widthCm,
        heightCm: override.heightCm,
        isFragileOverride: override.isFragileOverride,
        isBulkyOverride: override.isBulkyOverride,
        shippingClassOverride: override.shippingClassOverride,
        inStock: true,
        imagesJson: pics(vSku),
        isActive: true,
        availableQty: 0,
        options: {
          create: [
            { attributeId: color.attributeId, valueId: combo.c },
            { attributeId: size.attributeId, valueId: combo.s },
          ],
        },
      },
      select: { id: true, sku: true, retailPrice: true },
    });

    createdVariants.push(variant);
  }

  return createdVariants;
}

/* ----------------------------------------------------------------------------
  Offers
---------------------------------------------------------------------------- */

function supplierBaseFromRetail(retail: number): Prisma.Decimal {
  const pct = 0.5 + Math.random() * 0.25;
  const val = Math.max(300, Math.round(retail * pct));
  return new Prisma.Decimal(val);
}

function supplierUnitPriceFromVariantRetail(variantRetail: number): Prisma.Decimal {
  const pct = 0.5 + Math.random() * 0.28;
  const val = Math.max(300, Math.round(variantRetail * pct));
  return new Prisma.Decimal(val);
}

async function ensureBaseOfferForProduct(args: {
  productId: string;
  retail: number;
  supplierId: string;
}) {
  const { productId, retail, supplierId } = args;
  const availableQty = randInt(MIN_AVAILABLE, MAX_AVAILABLE);

  return prisma.supplierProductOffer.upsert({
    where: {
      supplier_product_offer_unique: {
        productId,
        supplierId,
      },
    },
    update: {
      basePrice: supplierBaseFromRetail(retail),
      availableQty,
      inStock: availableQty > 0,
      isActive: true,
      leadDays: randInt(1, 7),
      currency: "NGN",
    },
    create: {
      productId,
      supplierId,
      basePrice: supplierBaseFromRetail(retail),
      availableQty,
      inStock: availableQty > 0,
      isActive: true,
      leadDays: randInt(1, 7),
      currency: "NGN",
    },
    select: { id: true, availableQty: true, productId: true },
  });
}

async function ensureVariantOffersForVariants(args: {
  productId: string;
  variants: { id: string; retailPrice: Prisma.Decimal | null }[];
  baseOfferId: string;
  supplierId: string;
}) {
  const { productId, variants, baseOfferId, supplierId } = args;

  for (const v of variants) {
    if (!chance(0.6)) continue;

    const vr = Number(v.retailPrice ?? 0) || 0;
    if (vr <= 0) continue;

    const qty = randInt(MIN_AVAILABLE, MAX_AVAILABLE);

    await prisma.supplierVariantOffer.upsert({
      where: {
        supplier_variant_offer_unique: {
          variantId: v.id,
          supplierId,
        },
      },
      update: {
        productId,
        supplierProductOfferId: baseOfferId,
        supplierId,
        unitPrice: supplierUnitPriceFromVariantRetail(vr),
        availableQty: qty,
        inStock: qty > 0,
        isActive: true,
        leadDays: randInt(1, 9),
        currency: "NGN",
      },
      create: {
        productId,
        variantId: v.id,
        supplierProductOfferId: baseOfferId,
        supplierId,
        unitPrice: supplierUnitPriceFromVariantRetail(vr),
        availableQty: qty,
        inStock: qty > 0,
        isActive: true,
        leadDays: randInt(1, 9),
        currency: "NGN",
      },
      select: { id: true },
    });
  }

  for (const v of variants) {
    const agg = await prisma.supplierVariantOffer.aggregate({
      _sum: { availableQty: true },
      where: { variantId: v.id, isActive: true, inStock: true },
    });

    const sum = Number(agg._sum.availableQty || 0);
    await prisma.productVariant.update({
      where: { id: v.id },
      data: { availableQty: sum, inStock: sum > 0 },
    });
  }
}

async function recomputeProductAvailability(productId: string) {
  const baseAgg = await prisma.supplierProductOffer.aggregate({
    _sum: { availableQty: true },
    where: { productId, isActive: true, inStock: true },
  });

  const varAgg = await prisma.supplierVariantOffer.aggregate({
    _sum: { availableQty: true },
    where: { productId, isActive: true, inStock: true },
  });

  const baseQty = Number(baseAgg._sum.availableQty ?? 0);
  const variantQty = Number(varAgg._sum.availableQty ?? 0);
  const total = Math.max(0, Math.trunc(baseQty + variantQty));

  await prisma.product.update({
    where: { id: productId },
    data: { availableQty: total, inStock: total > 0 },
  });
}

/* ----------------------------------------------------------------------------
  Shipping setup
---------------------------------------------------------------------------- */
async function ensureShippingSetup() {
  log("Ensuring shipping zones + rate cards...");

  const zones: Array<{
    code: string;
    name: string;
    statesJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    lgasJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    priority: number;
  }> = [
    {
      code: "LAGOS_LOCAL",
      name: "Lagos Local",
      statesJson: ["Lagos"],
      lgasJson: [
        "Ikeja",
        "Eti-Osa",
        "Surulere",
        "Kosofe",
        "Alimosho",
        "Mushin",
        "Lagos Island",
        "Lagos Mainland",
      ],
      priority: 10,
    },
    {
      code: "SW_NEAR",
      name: "South West (Near)",
      statesJson: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"],
      lgasJson: Prisma.JsonNull,
      priority: 20,
    },
    {
      code: "SOUTH_REGIONAL",
      name: "South (Regional)",
      statesJson: [
        "Abia",
        "Anambra",
        "Akwa Ibom",
        "Bayelsa",
        "Cross River",
        "Delta",
        "Edo",
        "Ebonyi",
        "Enugu",
        "Imo",
        "Rivers",
      ],
      lgasJson: Prisma.JsonNull,
      priority: 30,
    },
    {
      code: "NORTH_REGIONAL",
      name: "North (Regional)",
      statesJson: [
        "FCT",
        "Abuja",
        "Federal Capital Territory",
        "Kaduna",
        "Kano",
        "Plateau",
        "Nasarawa",
        "Benue",
        "Niger",
        "Kwara",
        "Borno",
        "Bauchi",
        "Adamawa",
        "Sokoto",
        "Kebbi",
        "Zamfara",
        "Katsina",
        "Jigawa",
        "Yobe",
        "Taraba",
        "Gombe",
        "Kogi",
      ],
      lgasJson: Prisma.JsonNull,
      priority: 40,
    },
    {
      code: "NIGERIA_FALLBACK",
      name: "Nigeria Fallback",
      statesJson: Prisma.JsonNull,
      lgasJson: Prisma.JsonNull,
      priority: 999,
    },
  ];

  const zoneByCode = new Map<string, string>();

  for (const z of zones) {
    const zone = await prisma.shippingZone.upsert({
      where: { code: z.code },
      update: {
        name: z.name,
        country: "Nigeria",
        statesJson: z.statesJson,
        lgasJson: z.lgasJson,
        isActive: true,
        priority: z.priority,
      },
      create: {
        code: z.code,
        name: z.name,
        country: "Nigeria",
        statesJson: z.statesJson,
        lgasJson: z.lgasJson,
        isActive: true,
        priority: z.priority,
      },
      select: { id: true, code: true },
    });

    zoneByCode.set(zone.code, zone.id);
  }

  await prisma.shippingRateCard.deleteMany({
    where: { zoneId: { in: [...zoneByCode.values()] } },
  });

  const bands = [
    { min: 0, max: 1000 },
    { min: 1000, max: 3000 },
    { min: 3000, max: 5000 },
    { min: 5000, max: 10000 },
    { min: 10000, max: null },
  ];

  const zonePricing: Record<
    string,
    { base: number; perKg: number; remote: number; fallback?: boolean }
  > = {
    LAGOS_LOCAL: { base: 900, perKg: 180, remote: 0 },
    SW_NEAR: { base: 1400, perKg: 260, remote: 120 },
    SOUTH_REGIONAL: { base: 1900, perKg: 360, remote: 220 },
    NORTH_REGIONAL: { base: 2400, perKg: 480, remote: 300 },
    NIGERIA_FALLBACK: { base: 3500, perKg: 650, remote: 500, fallback: true },
  };

  for (const [code, zoneId] of zoneByCode.entries()) {
    const p = zonePricing[code];

    for (const b of bands) {
      const heavyAdder = b.min >= 5000 ? 350 : 0;
      const fragileAdder = b.min >= 5000 ? 450 : 0;
      const bulkyAdder = b.min >= 5000 ? 600 : 0;

      await prisma.shippingRateCard.create({
        data: {
          zoneId,
          serviceLevel: "STANDARD",
          parcelClass: "STANDARD",
          minWeightGrams: b.min,
          maxWeightGrams: b.max,
          volumetricDivisor: 5000,
          baseFee: toDec2(p.base + heavyAdder),
          perKgFee: toDec2(p.perKg),
          remoteSurcharge: toDec2(p.remote),
          fuelSurcharge: toDec2(p.fallback ? 180 : 70),
          handlingFee: toDec2(p.fallback ? 150 : 50),
          currency: "NGN",
          etaMinDays:
            code === "LAGOS_LOCAL"
              ? 1
              : code === "SW_NEAR"
                ? 2
                : code === "NIGERIA_FALLBACK"
                  ? 4
                  : 3,
          etaMaxDays:
            code === "LAGOS_LOCAL"
              ? 2
              : code === "SW_NEAR"
                ? 4
                : code === "NIGERIA_FALLBACK"
                  ? 8
                  : 6,
          isActive: true,
        },
      });

      await prisma.shippingRateCard.create({
        data: {
          zoneId,
          serviceLevel: "STANDARD",
          parcelClass: "FRAGILE",
          minWeightGrams: b.min,
          maxWeightGrams: b.max,
          volumetricDivisor: 5000,
          baseFee: toDec2(p.base + 300 + fragileAdder),
          perKgFee: toDec2(p.perKg + 70),
          remoteSurcharge: toDec2(p.remote),
          fuelSurcharge: toDec2(p.fallback ? 220 : 90),
          handlingFee: toDec2(p.fallback ? 220 : 120),
          currency: "NGN",
          etaMinDays:
            code === "LAGOS_LOCAL"
              ? 1
              : code === "SW_NEAR"
                ? 2
                : code === "NIGERIA_FALLBACK"
                  ? 4
                  : 3,
          etaMaxDays:
            code === "LAGOS_LOCAL"
              ? 2
              : code === "SW_NEAR"
                ? 4
                : code === "NIGERIA_FALLBACK"
                  ? 9
                  : 7,
          isActive: true,
        },
      });

      await prisma.shippingRateCard.create({
        data: {
          zoneId,
          serviceLevel: "STANDARD",
          parcelClass: "BULKY",
          minWeightGrams: b.min,
          maxWeightGrams: b.max,
          volumetricDivisor: 4000,
          baseFee: toDec2(p.base + 550 + bulkyAdder),
          perKgFee: toDec2(p.perKg + 110),
          remoteSurcharge: toDec2(p.remote + 80),
          fuelSurcharge: toDec2(p.fallback ? 260 : 110),
          handlingFee: toDec2(p.fallback ? 260 : 150),
          currency: "NGN",
          etaMinDays:
            code === "LAGOS_LOCAL"
              ? 1
              : code === "SW_NEAR"
                ? 2
                : code === "NIGERIA_FALLBACK"
                  ? 5
                  : 4,
          etaMaxDays:
            code === "LAGOS_LOCAL"
              ? 3
              : code === "SW_NEAR"
                ? 5
                : code === "NIGERIA_FALLBACK"
                  ? 10
                  : 8,
          isActive: true,
        },
      });
    }
  }

  log("Shipping zones + rate cards ensured.");
}

/* ----------------------------------------------------------------------------
  Product generation
---------------------------------------------------------------------------- */

function baseTitlesPool() {
  return [
    "Electric Kettle",
    "Wireless Headphones",
    "Cotton T-Shirt",
    "Running Sneakers",
    "Bluetooth Speaker",
    "Kitchen Blender",
    "Analog Wristwatch",
    "Laptop Backpack",
    "Silicone Phone Case",
    "Desk Lamp",
    "Insulated Water Bottle",
    "Power Bank",
    "Standing Fan",
    "2-Slice Toaster",
    "Wireless Mouse",
    "Mechanical Keyboard",
    "USB Wall Charger",
    "Wi-Fi Router",
    "Extension Cable",
    "Ceramic Coffee Mug",
    "Pressure Cooker",
    "Air Fryer",
    "Microwave Oven",
    "Water Bottle",
    "Flask Set",
    "Dinner Plate Set",
    "Serving Bowl",
    "Storage Container Set",
    "Lunch Box",
    "Dish Rack",
    "Spice Rack",
    "Drawer Organizer",
    "Mop Bucket Set",
    "Floor Cleaner",
    "Bathroom Cleaner",
    "Kitchen Cleaner",
    "Trash Bin",
    "Air Freshener",
    "Steam Iron",
    "Water Dispenser",
    "Refrigerator Organizer",
    "Laundry Basket",
    "Drying Rack",
    "Ironing Board",
    "Wardrobe Organizer",
    "Stackable Bin",
    "LED Lamp",
    "Power Strip",
    "Lantern Light",
    "Garden Hose",
  ];
}

async function seedProducts(args: {
  superAdminId: string;
  categories: { id: string; name?: string }[];
  brands: { id: string; name: string; slug: string }[];
  suppliers: { id: string }[];
  attrs: Awaited<ReturnType<typeof ensureAttributes>>;
}) {
  const { superAdminId, categories, brands, suppliers, attrs } = args;

  const liveTargets = LIVE_PRODUCTS_TOTAL;
  const pendingTargets = PENDING_PRODUCTS_TOTAL;

  log(`Seeding ${liveTargets} LIVE products, ${pendingTargets} PENDING products…`);

  if (brands.length < 4) {
    throw new Error("Need at least 4 brands to satisfy 2–4 brands per base product.");
  }

  const plan: Array<{
    status: string;
    title: string;
    brandId: string;
    sku: string;
    retail: number;
  }> = [];

  const titles = baseTitlesPool();
  let liveCount = 0;
  let globalIndex = 1;

  for (const t of titles) {
    if (liveCount >= liveTargets) break;

    const nBrands = randInt(MIN_BRANDS_PER_BASE, MAX_BRANDS_PER_BASE);
    const chosenBrands = pick(brands, nBrands);

    for (const b of chosenBrands) {
      if (liveCount >= liveTargets) break;

      const sku = `LIVE-${String(globalIndex).padStart(3, "0")}`;
      const retail = 9000 + globalIndex * 450;

      plan.push({ status: "LIVE", title: t, brandId: b.id, sku, retail });

      liveCount++;
      globalIndex++;
    }
  }

  if (liveCount < liveTargets) {
    throw new Error(
      `Unable to build ${liveTargets} LIVE products from current title/brand pool. Built only ${liveCount}.`
    );
  }

  for (let i = 1; i <= pendingTargets; i++) {
    const baseTitle = titles[(i - 1) % titles.length];
    const title = `${baseTitle} (Pending Review)`;
    const b = brands[(i - 1) % brands.length];
    const sku = `PEND-${String(i).padStart(3, "0")}`;
    const retail = 6500 + i * 500;
    plan.push({ status: "PENDING", title, brandId: b.id, sku, retail });
  }

  const usedBySupplier = new Map<string, Set<string>>();

  for (const item of plan) {
    const categoryId = categories[randInt(0, categories.length - 1)].id;

    const supplierId = pickSupplierForItem(suppliers, usedBySupplier, item.title, item.brandId);
    const key = productKeyForSupplier(item.title, item.brandId);
    const set = usedBySupplier.get(supplierId) ?? new Set<string>();
    set.add(key);
    usedBySupplier.set(supplierId, set);

    const existing = await prisma.product.findFirst({
      where: {
        supplierId,
        brandId: item.brandId,
        sku: item.sku,
        isDeleted: false,
      },
      select: { id: true },
    });

    const parcel = parcelForTitle(item.title);

    const product = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data: {
            title: item.title,
            description:
              item.status === "LIVE"
                ? "Live product seeded for development and testing."
                : "Pending product seeded for development and testing.",
            retailPrice: toDec(item.retail),
            sku: item.sku,
            status: item.status,
            imagesJson: pics(`${item.sku}-${item.brandId}`),
            isDeleted: false,
            availableQty: 0,
            inStock: true,
            shippingCost: toDec2(0),
            weightGrams: parcel.weightGrams,
            lengthCm: toDec2(parcel.lengthCm),
            widthCm: toDec2(parcel.widthCm),
            heightCm: toDec2(parcel.heightCm),
            isFragile: parcel.isFragile,
            isBulky: parcel.isBulky,
            shippingClass: parcel.shippingClass,
            freeShipping: false,
            supplier: { connect: { id: supplierId } },
            category: { connect: { id: categoryId } },
            brand: { connect: { id: item.brandId } },
            owner: { connect: { id: superAdminId } },
            createdBy: { connect: { id: superAdminId } },
            updatedBy: { connect: { id: superAdminId } },
          },
          select: { id: true, sku: true },
        })
      : await prisma.product.create({
          data: {
            title: item.title,
            description:
              item.status === "LIVE"
                ? "Live product seeded for development and testing."
                : "Pending product seeded for development and testing.",
            retailPrice: toDec(item.retail),
            sku: item.sku,
            status: item.status,
            imagesJson: pics(`${item.sku}-${item.brandId}`),
            isDeleted: false,
            availableQty: 0,
            inStock: true,
            shippingCost: toDec2(0),
            weightGrams: parcel.weightGrams,
            lengthCm: toDec2(parcel.lengthCm),
            widthCm: toDec2(parcel.widthCm),
            heightCm: toDec2(parcel.heightCm),
            isFragile: parcel.isFragile,
            isBulky: parcel.isBulky,
            shippingClass: parcel.shippingClass,
            freeShipping: false,
            supplier: { connect: { id: supplierId } },
            category: { connect: { id: categoryId } },
            brand: { connect: { id: item.brandId } },
            owner: { connect: { id: superAdminId } },
            createdBy: { connect: { id: superAdminId } },
            updatedBy: { connect: { id: superAdminId } },
          },
          select: { id: true, sku: true },
        });

    await ensureProductAttributeOptions(product.id, attrs);

    const wantsVariants =
      item.status === "LIVE"
        ? chance(LIVE_VARIANT_FRACTION)
        : chance(PENDING_VARIANT_FRACTION);

    await prisma.supplierVariantOffer.deleteMany({
      where: { productId: product.id },
    });
    await prisma.productVariant.deleteMany({
      where: { productId: product.id },
    });
    await prisma.supplierProductOffer.deleteMany({
      where: { productId: product.id },
    });

    const baseOffer = await ensureBaseOfferForProduct({
      productId: product.id,
      retail: item.retail,
      supplierId,
    });

    if (wantsVariants) {
      const variants = await createVariantsForProduct({
        productId: product.id,
        skuBase: item.sku,
        retail: item.retail,
        attrs,
        productParcel: parcel,
      });

      await ensureVariantOffersForVariants({
        productId: product.id,
        variants,
        baseOfferId: baseOffer.id,
        supplierId,
      });
    }

    await recomputeProductAvailability(product.id);
  }

  log("Products seeded.");
}

/* ----------------------------------------------------------------------------
  Validation (shipping readiness)
---------------------------------------------------------------------------- */
async function validateSeedShippingReadiness() {
  log("Validating shipping readiness...");

  const badProducts = await prisma.product.findMany({
    where: {
      isDeleted: false,
      OR: [
        { weightGrams: null },
        { lengthCm: null },
        { widthCm: null },
        { heightCm: null },
        { shippingClass: null },
      ],
    },
    select: { id: true, title: true, sku: true },
    take: 20,
  });

  if (badProducts.length) {
    throw new Error(
      `Shipping validation failed: ${badProducts.length} product(s) missing parcel fields. ` +
        `Examples: ${badProducts.map((p) => p.sku || p.id).join(", ")}`
    );
  }

  const badVariants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      OR: [
        { weightGrams: null },
        { lengthCm: null },
        { widthCm: null },
        { heightCm: null },
        { shippingClassOverride: null },
      ],
    },
    select: { id: true, sku: true },
    take: 20,
  });

  if (badVariants.length) {
    throw new Error(
      `Shipping validation failed: ${badVariants.length} variant(s) missing parcel override fields. ` +
        `Examples: ${badVariants.map((v) => v.sku || v.id).join(", ")}`
    );
  }

  const badSuppliers = await prisma.supplier.findMany({
    where: {
      OR: [
        { shippingEnabled: false },
        { shipsNationwide: false },
        { registeredAddressId: null },
        { pickupAddressId: null },
      ],
    },
    select: { id: true, name: true },
    take: 20,
  });

  if (badSuppliers.length) {
    throw new Error(
      `Shipping validation failed: ${badSuppliers.length} supplier(s) not shipping-ready. ` +
        `Examples: ${badSuppliers.map((s) => s.name).join(", ")}`
    );
  }

  const zones = await prisma.shippingZone.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });

  for (const z of zones) {
    const count = await prisma.shippingRateCard.count({
      where: { zoneId: z.id, isActive: true },
    });
    if (count === 0) {
      throw new Error(
        `Shipping validation failed: zone ${z.code} has no active rate cards`
      );
    }
  }

  log("Shipping readiness validation passed ✅");
}

/* ----------------------------------------------------------------------------
  Main
---------------------------------------------------------------------------- */
async function main() {
  await ensureCoreSettings();
  await ensureShippingSetup();

  const superId = await ensureSuperAdmin();
  const { suppliers } = await ensureSupplierUserAndSuppliers();
  const categories = await ensureCategoriesFromTree();
  const brands = await ensureBrands();
  const attrs = await ensureAttributes();

  await seedProducts({
    superAdminId: superId,
    categories,
    brands,
    suppliers,
    attrs,
  });

  await validateSeedShippingReadiness();

  log("Seed complete.");
  log(`Super Admin: ${SUPER_EMAIL} / ${SUPER_PASS}`);
  log(`Supplier: ${SUPPLIER_EMAIL} / ${SUPPLIER_PASS}`);
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });