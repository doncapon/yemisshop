// api/prisma/seedCategories.ts
import { PrismaClient } from "@prisma/client";

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export type CatNode = { name: string; children?: CatNode[] };

export const CATEGORY_TREE: CatNode[] = [
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

async function ensureUniqueCategorySlug(prisma: PrismaClient, base: string) {
  const s0 = slugify(base) || "category";
  let s = s0;
  let i = 2;

  while (true) {
    const exists = await prisma.category.findFirst({ where: { slug: s } });
    if (!exists) return s;
    s = `${s0}-${i++}`;
  }
}

async function upsertCategoryNode(
  prisma: PrismaClient,
  node: CatNode,
  parentId?: string,
  position = 0
) {
  const existing = await prisma.category.findUnique({
    where: { name: node.name },
  });

  if (!existing) {
    const slug = await ensureUniqueCategorySlug(prisma, node.name);

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
        await upsertCategoryNode(prisma, node.children[i], created.id, i);
      }
    }

    return created;
  }

  const patch: Record<string, unknown> = {};
  let needUpdate = false;

  if (!existing.slug) {
    patch.slug = await ensureUniqueCategorySlug(prisma, existing.name);
    needUpdate = true;
  }

  if (parentId && !existing.parentId) {
    patch.parentId = parentId;
    needUpdate = true;
  }

  if (typeof position === "number" && existing.position === 0 && position !== 0) {
    patch.position = position;
    needUpdate = true;
  }

  const saved = needUpdate
    ? await prisma.category.update({
        where: { id: existing.id },
        data: patch,
      })
    : existing;

  if (node.children?.length) {
    for (let i = 0; i < node.children.length; i++) {
      await upsertCategoryNode(prisma, node.children[i], saved.id, i);
    }
  }

  return saved;
}

export async function seedCategoriesTree(prisma: PrismaClient) {
  for (let i = 0; i < CATEGORY_TREE.length; i++) {
    await upsertCategoryNode(prisma, CATEGORY_TREE[i], undefined, i);
  }
}