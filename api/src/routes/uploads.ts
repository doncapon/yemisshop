// routes/uploads.ts
import * as path from 'path';
import * as fs from 'fs';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';

const router = Router();

// Where to put files (configurable)
const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads');

// Make sure the folder exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]/g, '_');
    const stamp = Date.now();
    cb(null, `${stamp}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 20, fileSize: 10 * 1024 * 1024 }, // 10MB per file
});

// Helper to build absolute URLs consistently
function absoluteBase(req: any) {
  // Prefer explicit env if you deploy behind a proxy/CDN
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  // Fallback to request host (works locally)
  return `${req.protocol}://${req.get('host')}`;
}

// POST /api/uploads
router.post('/', upload.array('files'), (req, res) => {
  const files = (req.files || []) as Express.Multer.File[];
  const base = absoluteBase(req);
  const urls = files.map((f) => `${base}/uploads/${path.basename(f.path)}`);
  return res.json({ urls });
});

router.use((
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {

  if (err instanceof MulterError) {
    // Multer (e.g., LIMIT_FILE_SIZE, etc.)
    return res.status(400).json({ error: `Upload error: ${err.message}`, code: err.code });
  }

  if (err instanceof Error) {
    // Generic error with message
    return res.status(500).json({ error: err.message || 'Upload failed' });
  }

  // Fallback for non-Error throwables
  return res.status(500).json({ error: 'Unknown upload error' });
});

export default router;
