// api/src/services/notifications.service.ts
import { prisma } from "../lib/prisma.js";

export async function notifyUser(userId: string, payload: {
  type: any;
  title: string;
  body: string;
  data?: any;
}) {
  if (!userId) return;
  await prisma.notification.create({
    data: {
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
    },
  });
}

export async function notifyMany(userIds: string[], payload: {
  type: any;
  title: string;
  body: string;
  data?: any;
}) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return;
  await prisma.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
    })),
  });
}
