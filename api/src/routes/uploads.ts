// routes/uploads.ts
import * as path from "path";
import * as fs from "fs";
import { Router, Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";

const router = Router();

const IS_SERVERLESS =
  !!process.env.NETLIFY ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.VERCEL;

const UPLOADS_DIR =
  process.env.UPLOADS_DIR ??
  (IS_SERVERLESS ? "/tmp/uploads" : path.resolve(process.cwd(), "uploads"));

function ensureUploadsDir() {
  // create lazily (request-time), never at import-time
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureUploadsDir();
      cb(null, UPLOADS_DIR);
    } catch (e) {
      cb(e as any, UPLOADS_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]/g, "_");
    const stamp = Date.now();
    cb(null, `${stamp}-${safe}`);
  },
});

// Optional: restrict to images only
const IMAGES_ONLY =
  String(process.env.UPLOADS_IMAGES_ONLY || "").toLowerCase() === "true";

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (!IMAGES_ONLY) return cb(null, true);

  if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) return cb(null, true);
  cb(new MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 20,
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

function absoluteBase(req: any) {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
  return `${proto}://${host}`;
}

function collectFiles(req: Request): Express.Multer.File[] {
  const anyReq = req as any;

  if (anyReq.files && !Array.isArray(anyReq.files) && typeof anyReq.files === "object") {
    const obj = anyReq.files as Record<string, Express.Multer.File[]>;
    return Object.values(obj).flat().filter(Boolean);
  }

  if (Array.isArray(anyReq.files)) return anyReq.files.filter(Boolean);

  if (anyReq.file) return [anyReq.file].filter(Boolean);

  return [];
}

/**
 * POST /api/uploads
 * fields: files, files[], file
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
      return res.status(400).json({
        error: "No files uploaded. Use field 'files' (multi) or 'file' (single).",
      });
    }

    const base = absoluteBase(req);

    // ✅ IMPORTANT: serve via /api so Netlify redirect forwards it to the function
    const urls = files.map((f) => `${base}/api/uploads/files/${encodeURIComponent(f.filename)}`);

    return res.json({ urls });
  }
);

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
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
