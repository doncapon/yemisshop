// src/types/express.d.ts
import type { Role } from '../store/auth'; // or define your Role union here if API is standalone

declare module 'express-serve-static-core' {
  interface Request {
    /** JWT claims you attach in authMiddleware */
    user?: {
      id: string;
      email: string;
      role: 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER' | 'SUPPLIER';
      supplierId?: string | null;
    };

    /** High-level flag the app uses to decide if user should be nudged to verify */
    needsVerification?: boolean;

    /** Granular verification flags you can compute in middleware */
    verifications?: {
      email: boolean;
      phone: boolean;
      payment: boolean; // e.g., default payment method on file
    };
  }
}
