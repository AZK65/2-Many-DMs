import crypto from "node:crypto";

// AES-256-GCM encryption for secrets at rest (platform session blobs, proxy
// credentials). The key comes from APP_ENCRYPTION_KEY (32 bytes, hex or base64).
// In dev we fall back to a fixed key so the app runs, but production MUST set a
// real key — rotating it invalidates stored sessions (users re-link).
function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_ENCRYPTION_KEY is required in production");
    }
    // Deterministic dev key — NOT for production.
    return crypto.createHash("sha256").update("omni-crm-dev-key").digest();
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv.tag.ciphertext, all base64
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString(
    "base64"
  )}`;
}

export function decrypt(blob: string): string {
  const [ivB64, tagB64, ctB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("malformed ciphertext");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
