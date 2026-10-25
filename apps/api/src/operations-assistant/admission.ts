import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.js';
import { getMytDateParts, mytDateToEndUtcExclusive } from '../../../../packages/contracts/src/operations-assistant.js';

export const ADMISSION_ADVISORY_LOCK_KEY = 88471928371928n;
export const DEFAULT_DAILY_LIMIT = 500;
export const DEFAULT_GLOBAL_CONCURRENCY = 4;
export const ACCOUNT_WINDOW_LIMIT = 10;
export const ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

export type AdmissionLimits = {
  dailyLimit: number;
  globalConcurrency: number;
};

export type AdmittedLease = {
  requestId: string;
  accountId: string;
  slot: number;
};

export async function admitQueryRequest(
  pool: Pool,
  requestId: string,
  accountId: string,
  capturedNow: Date,
  limits: AdmissionLimits
): Promise<AdmittedLease> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");

    // 1. Serialize admission with transaction-level advisory lock
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMISSION_ADVISORY_LOCK_KEY.toString()]);

    // 2. Remove stale leases
    await client.query('DELETE FROM app_private.ai_request_leases WHERE expires_at <= clock_timestamp()');

    // 3. Check if account already has an active running question
    const activeAccountRes = await client.query(
      'SELECT expires_at FROM app_private.ai_request_leases WHERE account_id = $1',
      [accountId]
    );
    if (activeAccountRes.rowCount && activeAccountRes.rowCount > 0) {
      const expiresAt = new Date(activeAccountRes.rows[0].expires_at).getTime();
      const retryAfter = Math.max(1, Math.ceil((expiresAt - capturedNow.getTime()) / 1000));
      throw new AppError(
        429,
        'RATE_LIMITED',
        'An operations query is already running for this account.',
        undefined,
        retryAfter
      );
    }

    // 4. Find available global slot
    const slotsRes = await client.query('SELECT slot FROM app_private.ai_request_leases');
    const occupiedSlots = new Set<number>(slotsRes.rows.map((r: { slot: number }) => r.slot));
    let availableSlot: number | null = null;
    for (let s = 1; s <= limits.globalConcurrency; s++) {
      if (!occupiedSlots.has(s)) {
        availableSlot = s;
        break;
      }
    }

    if (availableSlot === null) {
      const earliestRes = await client.query('SELECT MIN(expires_at) as earliest FROM app_private.ai_request_leases');
      const earliest = earliestRes.rows[0]?.earliest;
      const retryAfter = earliest
        ? Math.max(1, Math.ceil((new Date(earliest).getTime() - capturedNow.getTime()) / 1000))
        : 5;
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'AI assistant capacity is currently full. Try again shortly.',
        undefined,
        retryAfter
      );
    }

    // 5. Check account 5-minute question quota (max 10 / 5 minutes)
    const accountUsageRes = await client.query(
      'SELECT window_started_at, admitted_count FROM app_private.ai_account_usage WHERE account_id = $1 FOR UPDATE',
      [accountId]
    );

    if (accountUsageRes.rowCount && accountUsageRes.rowCount > 0) {
      const currentWindow = accountUsageRes.rows[0];
      const windowStart = new Date(currentWindow.window_started_at).getTime();
      const elapsed = capturedNow.getTime() - windowStart;

      if (elapsed < ACCOUNT_WINDOW_MS) {
        if (currentWindow.admitted_count >= ACCOUNT_WINDOW_LIMIT) {
          const retryAfter = Math.max(1, Math.ceil((ACCOUNT_WINDOW_MS - elapsed) / 1000));
          throw new AppError(
            429,
            'RATE_LIMITED',
            'Account question quota reached. Please try again later.',
            undefined,
            retryAfter
          );
        }
        await client.query(
          'UPDATE app_private.ai_account_usage SET admitted_count = admitted_count + 1 WHERE account_id = $1',
          [accountId]
        );
      } else {
        await client.query(
          'UPDATE app_private.ai_account_usage SET window_started_at = $2, admitted_count = 1 WHERE account_id = $1',
          [accountId, capturedNow]
        );
      }
    } else {
      await client.query(
        'INSERT INTO app_private.ai_account_usage (account_id, window_started_at, admitted_count) VALUES ($1, $2, 1)',
        [accountId, capturedNow]
      );
    }

    // 6. Check deployment daily quota (MYT day)
    const mytDay = getMytDateParts(capturedNow).mytDay;
    const dailyUsageRes = await client.query(
      'SELECT admitted_count FROM app_private.ai_daily_usage WHERE myt_day = $1 FOR UPDATE',
      [mytDay]
    );

    if (dailyUsageRes.rowCount && dailyUsageRes.rowCount > 0) {
      const currentDaily = dailyUsageRes.rows[0];
      if (currentDaily.admitted_count >= limits.dailyLimit) {
        const nextMidnightUtc = mytDateToEndUtcExclusive(mytDay).getTime();
        const retryAfter = Math.max(1, Math.ceil((nextMidnightUtc - capturedNow.getTime()) / 1000));
        throw new AppError(
          429,
          'RATE_LIMITED',
          'Daily operations question quota reached.',
          undefined,
          retryAfter
        );
      }
      await client.query(
        'UPDATE app_private.ai_daily_usage SET admitted_count = admitted_count + 1 WHERE myt_day = $1',
        [mytDay]
      );
    } else {
      await client.query(
        'INSERT INTO app_private.ai_daily_usage (myt_day, admitted_count) VALUES ($1, 1)',
        [mytDay]
      );
    }

    // 7. Insert expiring lease (60 seconds)
    await client.query(
      "INSERT INTO app_private.ai_request_leases (request_id, account_id, slot, expires_at) VALUES ($1, $2, $3, clock_timestamp() + interval '60 seconds')",
      [requestId, accountId, availableSlot]
    );

    await client.query('COMMIT');
    return {
      requestId,
      accountId,
      slot: availableSlot
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseAdmissionLease(pool: Pool, requestId: string): Promise<void> {
  try {
    await pool.query('DELETE FROM app_private.ai_request_leases WHERE request_id = $1', [requestId]);
  } catch {
    // Best effort on release; lease will naturally expire in 60s
  }
}

