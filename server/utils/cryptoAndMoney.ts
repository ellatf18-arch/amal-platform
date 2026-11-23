import crypto from 'node:crypto';

/**
 * Half-up BigInt fixed-point tax calculation from basis points (100 bps = 1%).
 * Formula: (amountMinor * bps + 5000n) / 10000n
 */
export function calculateTaxMinorHalfUp(amountMinor: bigint, taxRateBps: number): bigint {
  if (amountMinor < 0n) throw new Error('amountMinor must be non-negative');
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) {
    throw new Error('taxRateBps must be an integer between 0 and 10000');
  }
  const bps = BigInt(taxRateBps);
  return (amountMinor * bps + 5000n) / 10000n;
}

export function etbToMinor(amountEtb: number): bigint {
  if (!Number.isFinite(amountEtb)) throw new Error('Invalid ETB amount');
  return BigInt(Math.round(amountEtb * 100));
}

export function minorToEtb(minor: bigint | string | number): number {
  const val = typeof minor === 'bigint' ? Number(minor) : Number(BigInt(minor));
  return val / 100;
}

export function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getQrEncryptionKey(): Buffer {
  const hex = process.env.QR_ENCRYPTION_KEY_HEX;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('QR_ENCRYPTION_KEY_HEX (32-byte hex) is required in production');
  }
  // Deterministic dev-only derived key when running locally without secret configured
  return crypto.createHash('sha256').update('amal-dev-qr-aes-key-v1').digest();
}

export function encryptQrToken(plaintextToken: string): {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
} {
  const key = getQrEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptQrToken(payload: {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}): string {
  const key = getQrEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString('utf8');
}
