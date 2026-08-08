// api/src/lib/r2.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

export function isR2Configured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && R2_PUBLIC_URL);
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

/**
 * Uploads a file buffer to the R2 bucket under `key` and returns its public URL.
 * Callers should check isR2Configured() first — this throws if credentials are missing.
 */
export async function uploadBufferToR2(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured (missing R2_* env vars).");
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return `${R2_PUBLIC_URL}/${key}`;
}
