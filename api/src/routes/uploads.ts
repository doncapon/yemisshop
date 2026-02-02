// routes/uploads.ts
import * as path from "path";
import * as fs from "fs";
import { Router, Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";

const router = Router();

// Where to put files (configurable)
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");

// Make sure the folder exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]/g, "_");
    const stamp = Date.now();
    cb(null, `${stamp}-${safe}`);
  },
});

// Optional: restrict to images only (set to "true" if you want)
// If you want all file types, leave it false.
const IMAGES_ONLY = String(process.env.UPLOADS_IMAGES_ONLY || "").toLowerCase() === "true";

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!IMAGES_ONLY) return cb(null, true);

  // images only
  if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) return cb(null, true);
  cb(new MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 20,
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
});

// Helper to build absolute URLs consistently
function absoluteBase(req: any) {
  // Prefer explicit env if you deploy behind a proxy/CDN
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  // If you're behind a proxy (Railway/NGINX), trust x-forwarded-* if enabled in app
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
  return `${proto}://${host}`;
}

// Collect uploaded files regardless of fields() shape
function collectFiles(req: Request): Express.Multer.File[] {
  const anyReq = req as any;

  // multer.fields => req.files is an object: { [fieldName]: File[] }
  if (anyReq.files && !Array.isArray(anyReq.files) && typeof anyReq.files === "object") {
    const obj = anyReq.files as Record<string, Express.Multer.File[]>;
    return Object.values(obj).flat().filter(Boolean);
  }

  // multer.array => req.files is File[]
  if (Array.isArray(anyReq.files)) return anyReq.files.filter(Boolean);

  // multer.single => req.file is File
  if (anyReq.file) return [anyReq.file].filter(Boolean);

  return [];
}

/**
 * POST /api/uploads
 * Accepts any of:
 * - files (multi)
 * - files[] (multi)
 * - file (single)
 *
 * Response: { urls: string[] }
 */
router.post(
  "/",
  upload.fields([
    { name: "files", maxCount: 20 },
    { name: "files[]", maxCount: 20 },
    { name: "file", maxCount: 1 },
  ]),
  (req, res) => {
    const files = collectFiles(req);

    if (!files.length) {
      return res.status(400).json({ error: "No files uploaded. Use field 'files' (multi) or 'file' (single)." });
    }

    const base = absoluteBase(req);
    const urls = files.map((f) => `${base}/uploads/${path.basename(f.path)}`);

    return res.json({ urls });
  }
);

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
    // Common Multer errors: LIMIT_FILE_SIZE, LIMIT_FILE_COUNT, LIMIT_UNEXPECTED_FILE, etc.
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "File too large (max 10MB)."
        : err.code === "LIMIT_FILE_COUNT"
        ? "Too many files."
        : err.code === "LIMIT_UNEXPECTED_FILE"
        ? "Unexpected file field. Use 'files' (multi) or 'file' (single)."
        : `Upload error: ${err.message}`;

    return res.status(400).json({ error: msg, code: err.code });
  }

  if (err instanceof Error) {
    return res.status(500).json({ error: err.message || "Upload failed" });
  }

  return res.status(500).json({ error: "Unknown upload error" });
});

export default router;
