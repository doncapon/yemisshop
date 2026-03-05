// api/prisma/seedCategories.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** -----------------------------
 * Helpers
 * ------------------------------*/
function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueCategorySlug(base: string) {
  const s0 = slugify(base) || "category";
  let s = s0;
  let i = 2;
  while (true) {
    const exists = await prisma.category.findFirst({ where: { slug: s } });
    if (!exists) return s;
    s = `${s0}-${i++}`;
  }
}

/** -----------------------------
 * Category tree (3-level)
 * NOTE: Category.name is @unique globally in your schema.
 * ------------------------------*/
type CatNode = { name: string; children?: CatNode[] };

const CATEGORY_TREE: CatNode[] = [
  {
    name: "Kitchen & Dining",
    children: [
      { name: "Cookware", children: [{ name: "Pots & Pans" }, { name: "Kettles" }, { name: "Pressure Cookers" }] },
      { name: "Bakeware", children: [{ name: "Baking Trays" }, { name: "Cake Moulds" }] },
      { name: "Kitchen Utensils", children: [{ name: "Spatulas" }, { name: "Spoons & Ladles" }, { name: "Whisks" }] },
      { name: "Food Storage", children: [{ name: "Storage Containers" }, { name: "Lunch Boxes" }, { name: "Zip Bags" }] },
      { name: "Dinnerware", children: [{ name: "Plates" }, { name: "Bowls" }, { name: "Serving Dishes" }] },
      { name: "Drinkware", children: [{ name: "Cups & Mugs" }, { name: "Water Bottles" }, { name: "Flasks" }] },
      { name: "Cutlery", children: [{ name: "Spoons" }, { name: "Forks" }, { name: "Knives" }] },
      { name: "Kitchen Organization", children: [{ name: "Dish Racks" }, { name: "Spice Racks" }, { name: "Drawer Organizers" }] },
      { name: "Kitchen Appliances", children: [{ name: "Blenders" }, { name: "Microwaves" }, { name: "Air Fryers" }, { name: "Toasters" }] },
    ],
  },
  {
    name: "Cleaning & Household",
    children: [
      { name: "Brooms & Brushes" },
      { name: "Mops & Buckets" },
      { name: "Cleaning Chemicals", children: [{ name: "Floor Cleaners" }, { name: "Bathroom Cleaners" }, { name: "Kitchen Cleaners" }] },
      { name: "Sponges & Scrubbers" },
      { name: "Cleaning Cloths" },
      { name: "Trash Bags & Bins", children: [{ name: "Trash Bags" }, { name: "Trash Bins" }] },
      { name: "Air Fresheners" },
    ],
  },
  {
    name: "Home Appliances",
    children: [
      { name: "Electric Kettles" },
      { name: "Irons" },
      { name: "Washing Machines" },
      { name: "Refrigerators" },
      { name: "Water Dispensers" },
      { name: "Fans & Cooling" },
    ],
  },
  {
    name: "Furniture",
    children: [
      { name: "Chairs" },
      { name: "Tables" },
      { name: "Cabinets" },
      { name: "Wardrobes" },
      { name: "Shelves & Racks", children: [{ name: "Shoe Racks" }, { name: "Kitchen Racks" }, { name: "Storage Racks" }] },
      { name: "TV Stands" },
      { name: "Bed Frames" },
      { name: "Mattresses" },
    ],
  },
  {
    name: "Bathroom",
    children: [
      { name: "Towels" },
      { name: "Bath Mats" },
      { name: "Shower Curtains" },
      { name: "Soap Dispensers" },
      { name: "Bathroom Storage", children: [{ name: "Bathroom Shelves" }, { name: "Toiletry Organizers" }] },
      { name: "Toilet Accessories", children: [{ name: "Toilet Brushes" }, { name: "Toilet Paper Holders" }] },
    ],
  },
  {
    name: "Laundry",
    children: [
      { name: "Laundry Baskets" },
      { name: "Drying Racks" },
      { name: "Pegs & Lines" },
      { name: "Ironing Boards" },
      { name: "Detergents & Softeners" },
    ],
  },
  {
    name: "Storage & Organization",
    children: [
      { name: "Storage Boxes" },
      { name: "Drawer Organizers" },
      { name: "Wardrobe Organizers" },
      { name: "Stackable Bins" },
      { name: "Hangers" },
    ],
  },
  {
    name: "Lighting & Electrical",
    children: [
      { name: "Bulbs" },
      { name: "Lamps" },
      { name: "LED Lights" },
      { name: "Extension Cables" },
      { name: "Power Strips" },
      { name: "Lanterns" },
    ],
  },
  {
    name: "Outdoor & Garden",
    children: [
      { name: "Flower Pots" },
      { name: "Garden Tools" },
      { name: "Watering Cans" },
      { name: "Garden Hoses" },
      { name: "Outdoor Chairs" },
    ],
  },
  {
    name: "Safety & Utilities",
    children: [
      { name: "First Aid Kits" },
      { name: "Fire Extinguishers" },
      { name: "Smoke Detectors" },
      { name: "Tool Kits" },
      { name: "Adhesives & Tapes" },
    ],
  },
];

/** -----------------------------
 * Attributes + values (SELECT-type)
 * Matches your schema:
 * Attribute(name,type,isActive)
 * AttributeValue(attributeId,name,code?,position,isActive)
 * ------------------------------*/
const ATTRS: Array<{ name: string; type?: string; values: string[] }> = [
  { name: "Color", values: ["Black", "White", "Silver", "Gray", "Red", "Blue", "Green", "Yellow", "Brown", "Gold", "Pink", "Transparent"] },
  { name: "Material", values: ["Plastic", "Stainless Steel", "Aluminium", "Glass", "Wood", "Ceramic", "Bamboo", "Silicone", "Metal", "Fabric", "Rubber"] },
  { name: "Size", values: ["XS", "S", "M", "L", "XL", "XXL"] },
  { name: "Capacity", values: ["250ml", "500ml", "750ml", "1L", "1.5L", "2L", "3L", "5L", "10L", "20L"] },
  { name: "Volume", values: ["250ml", "500ml", "750ml", "1L", "2L", "5L", "10L", "20L"] },
  { name: "Weight", values: ["Lightweight", "Medium", "Heavy"] },
  { name: "Power Source", values: ["Electric", "Battery", "Manual", "Gas", "Solar"] },
  { name: "Voltage", values: ["110V", "220V", "230V", "240V"] },
  { name: "Finish", values: ["Matte", "Glossy", "Polished", "Brushed"] },
  { name: "Shape", values: ["Round", "Square", "Rectangle", "Oval", "Cylinder"] },
  { name: "Usage", values: ["Indoor", "Outdoor", "Indoor & Outdoor"] },
  { name: "Pack Size", values: ["1", "2", "3", "4", "6", "8", "10", "12"] },
  { name: "Warranty", values: ["No Warranty", "3 Months", "6 Months", "1 Year", "2 Years"] },
  { name: "Condition", values: ["New", "Refurbished"] },
];

async function upsertCategoryNode(node: CatNode, parentId?: string, position = 0) {
  // Upsert by unique name
  const existing = await prisma.category.findUnique({ where: { name: node.name } });

  if (!existing) {
    const slug = await ensureUniqueCategorySlug(node.name);
    const created = await prisma.category.create({
      data: {
        name: node.name,
        slug,
        parentId: parentId ?? null,
        position,
        isActive: true,
      },
    });

    if (node.children?.length) {
      for (let i = 0; i < node.children.length; i++) {
        await upsertCategoryNode(node.children[i], created.id, i);
      }
    }
    return created;
  }

  // If exists: keep as-is; but we can fill parentId/slug if missing (safe)
  let needUpdate = false;
  const patch: any = {};

  if (!existing.slug) {
    patch.slug = await ensureUniqueCategorySlug(existing.name);
    needUpdate = true;
  }

  // only set parentId if it's currently null and we were given a parentId
  if (parentId && !existing.parentId) {
    patch.parentId = parentId;
    needUpdate = true;
  }

  if (typeof position === "number" && existing.position === 0 && position !== 0) {
    patch.position = position;
    needUpdate = true;
  }

  const updated = needUpdate
    ? await prisma.category.update({ where: { id: existing.id }, data: patch })
    : existing;

  if (node.children?.length) {
    for (let i = 0; i < node.children.length; i++) {
      await upsertCategoryNode(node.children[i], updated.id, i);
    }
  }

  return updated;
}

async function seedCategories() {
  for (let i = 0; i < CATEGORY_TREE.length; i++) {
    await upsertCategoryNode(CATEGORY_TREE[i], undefined, i);
  }
}

async function seedAttributes() {
  for (const spec of ATTRS) {
    // Attribute.name is NOT unique in your schema, so do findFirst+create
    let attr = await prisma.attribute.findFirst({
      where: { name: spec.name },
    });

    if (!attr) {
      attr = await prisma.attribute.create({
        data: {
          name: spec.name,
          type: spec.type ?? "SELECT",
          isActive: true,
        },
      });
    }

    // Seed values (AttributeValue also has no unique constraint; enforce idempotence in code)
    for (let pos = 0; pos < spec.values.length; pos++) {
      const valueName = spec.values[pos];

      const exists = await prisma.attributeValue.findFirst({
        where: { attributeId: attr.id, name: valueName },
      });

      if (exists) continue;

      await prisma.attributeValue.create({
        data: {
          attributeId: attr.id,
          name: valueName,
          position: pos,
          isActive: true,
        },
      });
    }
  }
}

async function main() {
  console.log("🌱 Seeding categories (with parent/child)...");
  await seedCategories();

  console.log("🌱 Seeding attributes + values...");
  await seedAttributes();

  console.log("✅ Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });