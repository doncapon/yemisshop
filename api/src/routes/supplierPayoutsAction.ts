// api/src/routes/supplierPayoutsAction.ts
import { Router, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { paySupplierForPurchaseOrder } from "../services/payout.service.js";

const router = Router();
const isSupplier = (role?: string) => role === "SUPPLIER";

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({ where: { userId }, select: { id: true } });
}

router.post(
  "/purchase-orders/:purchaseOrderId/release",
  requireAuth,
  async (req: any, res: Response) => {
    try {
      if (!isSupplier(req.user?.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const supplier = await getSupplierForUser(String(req.user?.id));
      if (!supplier?.id) {
        return res.status(403).json({ error: "Supplier access required" });
      }

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: String(req.params.purchaseOrderId) },
        select: { supplierId: true },
      });

      if (!po || po.supplierId !== supplier.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const out = await paySupplierForPurchaseOrder(
        String(req.params.purchaseOrderId),
        { id: req.user?.id, role: req.user?.role }
      );

      return res.json({ ok: true, data: out });
    } catch (e: any) {
      const status = e?.status || 500;
      return res
        .status(status)
        .json({ error: e?.message || "Failed to release payout" });
    }
  }
);

export default router;
