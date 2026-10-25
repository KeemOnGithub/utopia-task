import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { SessionData } from '@sejuk/contracts/api';
import type { Queryable } from '../db.js';
import { AppError } from '../errors.js';

export const validToken = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, 'base64url').toString('base64url') === token;
export const generateToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest();
export function getSessionToken(request: FastifyRequest): string | null {
  const name = request.server.config.production ? '__Host-session' : 'dev_session';
  const values = (request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0]!.slice(name.length + 1);
  return validToken(token) ? token : null;
}
export async function resolveSession(db: Queryable, token: string | null): Promise<SessionData> {
  if (!validToken(token)) throw unauthenticated();
  let rows;
  try {
    ({ rows } = await db.query('SELECT a.id,a.email,a.role,a.is_active,s.expires_at FROM app_private.sessions s JOIN app_private.accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()', [hashToken(token)]));
  } catch { throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Session verification is unavailable. Try again.'); }
  const row = rows[0];
  if (!row || !row.is_active) throw unauthenticated();
  if (row.role !== 'admin' && row.role !== 'manager') throw new AppError(403, 'FORBIDDEN', 'You do not have access to this portal.');
  return { user: { id: row.id, email: row.email, role: row.role as 'admin' | 'manager' }, expiresAt: new Date(row.expires_at).toISOString() };
}
export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
