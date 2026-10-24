import { createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import type { Pool } from 'pg';
import { transaction } from '../db.js';
import { AppError } from '../errors.js';
export function canonicalIp(ip: string): string { return ipaddr.process(ip).toNormalizedString(); }
export async function admitLogin(db: Pool, email: string, ip: string, now: Date = new Date(), secret = process.env.LOGIN_LIMIT_HMAC_SECRET): Promise<{allowed: boolean; retryAfterSeconds?: number}> {
  if (!secret || Buffer.byteLength(secret) < 32) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Sign in is unavailable. Try again.');
  try {
    const buckets = [{kind:'email', key:email, max:5},{kind:'ip',key:canonicalIp(ip),max:30}].map(bucket => ({...bucket,hash:createHmac('sha256',secret).update(`${bucket.kind}:${bucket.key}`).digest()}));
    return await transaction(db, async client => {
      const locked = [];
      for (const bucket of buckets) {
        const inserted = await client.query('INSERT INTO app_private.login_limits(kind,key_hash,window_started_at,attempt_count) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING RETURNING kind', [bucket.kind,bucket.hash,now]);
        const {rows} = await client.query('SELECT window_started_at,attempt_count FROM app_private.login_limits WHERE kind=$1 AND key_hash=$2 FOR UPDATE',[bucket.kind,bucket.hash]);
        const row = rows[0];
        locked.push({...bucket,start:new Date(row.window_started_at).getTime(),count:inserted.rowCount ? 0 : row.attempt_count});
      }
      let retry = 0;
      for (const bucket of locked) if (now.getTime()-bucket.start < 900000 && bucket.count >= bucket.max) retry = Math.max(retry,Math.ceil((bucket.start+900000-now.getTime())/1000));
      if (retry) throw new RateBlocked(Math.max(1,retry));
      for (const bucket of locked) {
        const elapsed = now.getTime()-bucket.start >= 900000;
        // A newly inserted bucket has already counted this admitted attempt.
        await client.query('UPDATE app_private.login_limits SET window_started_at=$3,attempt_count=$4 WHERE kind=$1 AND key_hash=$2',[bucket.kind,bucket.hash,elapsed?now:new Date(bucket.start),elapsed?1:bucket.count+1]);
      }
      return {allowed:true};
    });
  } catch (error) { if (error instanceof RateBlocked) return {allowed:false,retryAfterSeconds:error.seconds}; throw new AppError(503,'SERVICE_UNAVAILABLE','Sign in is unavailable. Try again.'); }
}
class RateBlocked extends Error { constructor(readonly seconds:number){super('Rate limited');} }
