import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ENC_PREFIX = 'enc:v1:';

function getSecret(): string {
  const secret = process.env.APP_FIELD_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('APP_FIELD_ENCRYPTION_KEY or NEXTAUTH_SECRET is required for field encryption');
  }
  return secret;
}

function deriveKey(userId: string): Buffer {
  return createHash('sha256').update(`${getSecret()}:${userId}:field`).digest();
}

function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export function encryptTextForUser(userId: string, value?: string | null): string | null {
  if (!value) return null;
  if (isEncrypted(value)) return value;

  const iv = randomBytes(12);
  const key = deriveKey(userId);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.from(
    JSON.stringify({
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      content: encrypted.toString('base64'),
    }),
    'utf8'
  ).toString('base64');

  return `${ENC_PREFIX}${payload}`;
}

export function decryptTextForUser(userId: string, value?: string | null): string | null {
  if (!value) return null;
  if (!isEncrypted(value)) return value;

  const payload = value.slice(ENC_PREFIX.length);
  const parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
    iv: string;
    tag: string;
    content: string;
  };

  const key = deriveKey(userId);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.content, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function encryptJsonForUser(
  userId: string,
  value: Record<string, unknown> | null | undefined
): string | null {
  if (!value) return null;
  return encryptTextForUser(userId, JSON.stringify(value));
}

export function decryptJsonForUser<T>(
  userId: string,
  value?: string | null
): T | null {
  const decrypted = decryptTextForUser(userId, value);
  if (!decrypted) return null;
  try {
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}
