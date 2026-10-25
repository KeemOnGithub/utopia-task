import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '@sejuk/contracts/api';
import type { Queryable } from '../db.js';
import { resolveSession, getSessionToken } from './session.js';
import { AppError } from '../errors.js';

export async function authorizeAdmin(db: Queryable, token: string | null): Promise<Actor> {
  const session = await resolveSession(db, token);
  if (session.user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Only administrators can perform this action.');
  }
  return { accountId: session.user.id, role: 'admin' };
}

export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<Actor> {
  const actor = await authorizeAdmin(request.server.db, getSessionToken(request));
  request.actor = actor;
  return actor;
}

export async function authorizeOrderReader(db: Queryable, token: string | null): Promise<Actor> {
  const session = await resolveSession(db, token);
  if (session.user.role !== 'admin' && session.user.role !== 'manager') {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to view orders.');
  }
  return { accountId: session.user.id, role: session.user.role };
}

export async function requireOrderReader(request: FastifyRequest, _reply: FastifyReply): Promise<Actor> {
  const actor = await authorizeOrderReader(request.server.db, getSessionToken(request));
  request.actor = actor;
  return actor;
}

declare module 'fastify' { interface FastifyRequest { actor?: Actor } }
