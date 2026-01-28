import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type Tx = Prisma.TransactionClient | PrismaClient;

function modelExists(name: string) {
    return Prisma.dmmf.datamodel.models.some((m) => m.name === name);
}
function delegateName(modelName: string) {
    return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}
function getModel(modelName: string) {
    return Prisma.dmmf.datamodel.models.find((m) => m.name === modelName) ?? null;
}
function getModelField(modelName: string, fieldName: string) {
    const m = getModel(modelName);
    return (m?.fields ?? []).find((f: any) => f.name === fieldName) ?? null;
}
async function safeAggregateSum(tx: any, modelName: string, where: any, field: string): Promise<number> {
    const delegate = tx[delegateName(modelName)];
    if (!delegate?.aggregate) return 0;
    try {
        const res = await delegate.aggregate({
            where,
            _sum: { [field]: true },
        });
        const v = res?._sum?.[field];
        const n = v == null ? 0 : Number(v);
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
}

/**
 * Recompute product stock from offers:
 * - totalAvailable = sum(availableQty) across eligible offers (active+inStock)
 * - inStock = totalAvailable > 0
 * Also updates Product.availableQty if that field exists.
 */
export async function recomputeProductStockTx(tx: Tx, productId: string) {
    const pid = String(productId || "").trim();
    if (!pid) return { totalAvailable: 0, inStock: false };

    const totals: { totalAvailable: number } = { totalAvailable: 0 };

    // --- 2-table offers ---
    if (modelExists("SupplierProductOffer")) {
        const where: any = { productId: pid };
        if (getModelField("SupplierProductOffer", "isActive")) where.isActive = true;
        if (getModelField("SupplierProductOffer", "inStock")) where.inStock = true;

        if (getModelField("SupplierProductOffer", "availableQty")) {
            totals.totalAvailable += await safeAggregateSum(tx, "SupplierProductOffer", where, "availableQty");
        }
    }

    if (modelExists("SupplierVariantOffer")) {
        const where: any = { productId: pid };
        if (getModelField("SupplierVariantOffer", "isActive")) where.isActive = true;
        if (getModelField("SupplierVariantOffer", "inStock")) where.inStock = true;

        if (getModelField("SupplierVariantOffer", "availableQty")) {
            totals.totalAvailable += await safeAggregateSum(tx, "SupplierVariantOffer", where, "availableQty");
        }
    }

    // --- single-table offers fallback (if you have it) ---
    // If you know the model name, you can add it here too, e.g. "SupplierOffer"
    // keeping the same pattern (isActive/inStock/availableQty sum).

    const inStock = totals.totalAvailable > 0;

    // Update Product.inStock and optionally Product.availableQty if it exists
    const productUpdate: any = {};
    if (getModelField("Product", "inStock")) productUpdate.inStock = inStock;
    if (getModelField("Product", "availableQty")) productUpdate.availableQty = totals.totalAvailable;

    if (Object.keys(productUpdate).length) {
        // ✅ updateMany avoids P2025 (it returns count instead of throwing)
        await (tx as any).product.updateMany({
            where: { id: pid },
            data: productUpdate,
        });
    }


    return { totalAvailable: totals.totalAvailable, inStock };
}
