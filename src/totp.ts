import { randomBytes, createHmac } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function base32Encode(buf: Buffer): string {
  let result = "";
  let bits = 0, value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += B32[(value << (5 - bits)) & 31];
  return result;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const result: number[] = [];
  for (const char of clean) {
    value = (value << 5) | B32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(result);
}

function totpAt(secret: Buffer, window: number): string {
  const counter = Math.floor(Date.now() / 30_000) + window;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  ) % 1_000_000;
  return String(code).padStart(6, "0");
}

export function verifyTotp(secret: Buffer, code: string): boolean {
  return [-1, 0, 1].some(w => totpAt(secret, w) === code);
}

export function buildOtpAuthUri(base32Secret: string, walletAddress: string): string {
  const label = encodeURIComponent(`Marmo:${walletAddress.slice(0, 10)}`);
  return `otpauth://totp/${label}?secret=${base32Secret}&issuer=Marmo&algorithm=SHA1&digits=6&period=30`;
}
