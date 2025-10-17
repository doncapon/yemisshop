// api/src/services/profile.service.ts
import { prisma }from '../lib/prisma.js';


export async function getMe(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  });
}
