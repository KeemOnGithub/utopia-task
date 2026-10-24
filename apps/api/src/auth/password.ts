import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';

export const passwordPolicy = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
let active = 0;
export function validPassword(value: unknown): value is string {
  if (typeof value !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return false;
  const length = Array.from(value).length;
  return length >= 8 && length <= 128;
}
async function bounded<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 4) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Sign in is busy. Try again.');
  active++;
  try { return await work(); } finally { active--; }
}
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error('Password must contain 8-128 Unicode characters without unpaired surrogates.');
  return bounded(() => argon2.hash(password, { ...passwordPolicy, salt: randomBytes(16) }));
}
export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bounded(async () => { try { return await argon2.verify(hash, password); } catch { return false; } });
}
export function needsRehash(hash: string): boolean {
  const parts=hash.split('$');
  return parts[1]!=='argon2id' || parts[2]!=='v=19' || parts[3]!=='m=65536,t=3,p=1' || Buffer.from(parts[4]??'','base64').length<16 || Buffer.from(parts[5]??'','base64').length!==32 || argon2.needsRehash(hash,passwordPolicy);
}
// Encoded once with the same resource policy. Its password is not an account credential.
export const dummyHash = '$argon2id$v=19$m=65536,t=3,p=1$c2VqdWstZHVtbXktc2FsdA$7O3SEwsYp1roXAUgza/ilN+CXbQe7cFVhxj5vX5Ew9g';
