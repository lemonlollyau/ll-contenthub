import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "./env";

// AES-256-GCM. Stored format: "v1:<iv>:<authTag>:<ciphertext>" (all base64).
// ENCRYPTION_KEY must be 32 random bytes, base64-encoded:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

function key(): Buffer {
  const k = Buffer.from(requireEnv("ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  }
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Stored secret is in an unknown format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** For showing "••••abcd" in the UI without ever sending the key to the browser. */
export function maskSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const plain = decryptSecret(stored);
    return `••••${plain.slice(-4)}`;
  } catch {
    return "•••• (unreadable)";
  }
}
