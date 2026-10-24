import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '@sejuk/contracts/api';
import type { Queryable } from '../db.js';
import { resolveSession, getSessionToken } from './session.js';
export async function authorizeAdmin(db: Queryable, token: string | null): Promise<Actor> {
  const session = await resolveSession(db, token);
  return { accountId: session.user.id, role: 'admin' };
}
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<Actor> {
  const actor = await authorizeAdmin(request.server.db, getSessionToken(request));
  request.actor = actor;
  return actor;
}
declare module 'fastify' { interface FastifyRequest { actor?: Actor } }
