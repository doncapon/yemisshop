// api/src/routes/notifications.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const take = Math.min(50, Math.max(1, Number(req.query.take ?? 20)));
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });

  return res.json({ data: rows });
});

router.post("/:id/read", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  const id = String(req.params.id || "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const n = await prisma.notification.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!n || n.userId !== userId) return res.status(404).json({ error: "Not found" });

  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  return res.json({ ok: true });
});

export default router;
