import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signJwt } from '../lib/jwt.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
  role: z.enum(['SHOPPER', 'SUPPLIER', 'ADMIN']).optional() // admin-only in real life
});

router.post('/register', async (req, res) => {
  const { email, password, name, role } = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: 'Email in use' });
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hash, name, role: role ?? 'SHOPPER' }
  });
  const token = signJwt({ id: user.id, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

router.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signJwt({ id: user.id, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

export default router;
