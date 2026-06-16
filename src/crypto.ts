import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

const SALT = "marmo-core-vault-v1";

function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, SALT, 32);
}

export function encryptSecret(plaintext: string, passphrase: string): string {
  const key = deriveKey(passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string, passphrase: string): string {
  const key = deriveKey(passphrase);
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function newApiKey(): string {
  return "mk_" + randomBytes(24).toString("hex");
}

export function newId(prefix: string): string {
  return prefix + "_" + randomBytes(12).toString("hex");
}
