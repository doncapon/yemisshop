// api/src/routes/uploads.ts
import * as path from "path";
import * as fs from "fs";
import { Router, Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";
import { isR2Configured, uploadBufferToR2 } from "../lib/r2.js";

const router = Router();

// Local-disk fallback, only used when R2 isn't configured (e.g. local dev
// without R2 credentials set up). In production, R2 is used instead, since
// Railway's local disk doesn't survive redeploys.
const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");

if (!isR2Configured()) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper: ensure a subfolder path is safe (no ../ etc.)
function safeSubfolder(input: unknown): string {
  if (!input) return "";
  let folder = String(input);

  // Normalise slashes
  folder = folder.replace(/\\/g, "/").trim();

  // Remove leading slashes
  folder = folder.replace(/^\/+/, "");

  // Block simple traversal attempts
  folder = folder.replace(/\.\./g, "");

  if (!folder) return "";
  return folder;
}

function buildRelPath(rawFolder: unknown, originalname: string): string {
  const subfolder = safeSubfolder(rawFolder);
  const safeName = originalname.replace(/[^\w.\- ]/g, "_");
  const stamp = Date.now();
  const filename = `${stamp}-${safeName}`;
  return subfolder ? `${subfolder}/${filename}` : filename;
}

// Multer storage: always buffer in memory. Whether that buffer ends up in
// R2 or on local disk is decided per-request in the route handler below.
const storage = multer.memoryStorage();

// Optional: restrict to images only (set to "true" if you want)
// For HR docs (PDF, images, etc.), LEAVE THIS FALSE in .env
const IMAGES_ONLY =
  String(process.env.UPLOADS_IMAGES_ONLY || "").toLowerCase() === "true";

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
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
  const host =
    (req.headers["x-forwarded-host"] as string) || req.get("host");
  return `${proto}://${host}`;
}

// Collect uploaded files regardless of fields() shape
function collectFiles(req: Request): Express.Multer.File[] {
  const anyReq = req as any;

  // multer.fields => req.files is an object: { [fieldName]: File[] }
  if (
    anyReq.files &&
    !Array.isArray(anyReq.files) &&
    typeof anyReq.files === "object"
  ) {
    const obj = anyReq.files as Record<string, Express.Multer.File[]>;
    return Object.values(obj)
      .flat()
      .filter(Boolean);
  }

  // multer.array => req.files is File[]
  if (Array.isArray(anyReq.files)) return anyReq.files.filter(Boolean);

  // multer.single => req.file is File
  if (anyReq.file) return [anyReq.file].filter(Boolean);

  return [];
}

/**
 * POST /api/uploads
 *
 * Accepts any of:
 * - files (multi)
 * - files[] (multi)
 * - file (single)
 * Optional:
 * - folder: subfolder under UPLOADS_DIR (e.g. "employees/<id>/docs")
 *
 * Files are stored in Cloudflare R2 when configured (production), or on
 * local disk as a dev fallback otherwise.
 *
 * Response:
 * {
 *   ok: true,
 *   files: [
 *     {
 *       key: "employees/123/docs/1730567890000-file.pdf",
 *       storageKey: "employees/123/docs/1730567890000-file.pdf",
 *       url: "/uploads/employees/123/docs/1730567890000-file.pdf",
 *       absoluteUrl: "https://example.com/uploads/employees/123/docs/1730567890000-file.pdf",
 *       originalFilename: "file.pdf",
 *       mimeType: "application/pdf",
 *       size: 12345
 *     }
 *   ],
 *   urls: ["/uploads/employees/123/docs/1730567890000-file.pdf"]
 * }
 */
router.post(
  "/",
  upload.fields([
    { name: "files", maxCount: 20 },
    { name: "files[]", maxCount: 20 },
    { name: "file", maxCount: 1 },
  ]),

  async (req, res, next) => {
    try {
      const files = collectFiles(req);

      if (!files.length) {
        return res.status(400).json({
          error:
            "No files uploaded. Use field 'files' (multi) or 'file' (single).",
        });
      }

      const base = absoluteBase(req);
      const rawFolder = (req.body as any)?.folder;
      const useR2 = isR2Configured();

      const payload = await Promise.all(
        files.map(async (f) => {
          const relPath = buildRelPath(rawFolder, f.originalname);

          let absoluteUrl: string;
          let urlPath: string;

          if (useR2) {
            absoluteUrl = await uploadBufferToR2(relPath, f.buffer, f.mimetype);
            urlPath = absoluteUrl;
          } else {
            const dest = path.join(UPLOADS_DIR, relPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, f.buffer);
            urlPath = `/uploads/${encodeURI(relPath)}`;
            absoluteUrl = `${base}${urlPath}`;
          }

          return {
            key: relPath,
            storageKey: relPath,
            url: urlPath,
            absoluteUrl,
            originalFilename: f.originalname,
            mimeType: f.mimetype,
            size: f.size,
          };
        })
      );

      const urls = payload.map((p) => p.url);

      return res.json({
        ok: true,
        files: payload,
        urls, // for backwards compatibility with existing image code
      });
    } catch (err) {
      next(err);
    }
  }
);

router.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
  }
);

export default router;
