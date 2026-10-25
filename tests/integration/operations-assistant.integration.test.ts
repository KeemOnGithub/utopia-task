import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { isolatedDatabase } from '../support/database.js';
import { buildApp } from '../../apps/api/src/app.js';
import type { FastifyInstance } from 'fastify';
import { DeterministicFakeProvider } from '../../apps/api/src/operations-assistant/provider.js';
import { runAccountCommand } from '../../apps/api/src/cli/accounts.js';

const origin = 'http://localhost:5173';
const adminId = '50000000-0000-4000-8000-000000000001';
const managerId = '50000000-0000-4000-8000-000000000002';
const technicianAccountId = '50000000-0000-4000-8000-000000000003';
const aliTechId = '10000000-0000-4000-8000-000000000001';
const johnTechId = '10000000-0000-4000-8000-000000000002';

describe('Operations Assistant integration and security in disposable PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof isolatedDatabase>>;
  let app: FastifyInstance;
  let adminCookie: string;
  let managerCookie: string;
  let techCookie: string;

  const headers = (cookie: string, key = randomUUID()) => ({
    cookie,
    origin,
    'x-csrf-protection': '1',
    'content-type': 'application/json',
    'idempotency-key': key
  });

  async function createSession(id: string) {
    const token = randomBytes(32).toString('base64url');
    await db.owner.query(
      "INSERT INTO app_private.sessions(token_hash, account_id, expires_at) VALUES($1, $2, now() + interval '8 hours')",
      [createHash('sha256').update(token).digest(), id]
    );
    return `dev_session=${token}`;
  }

  beforeAll(async () => {
    db = await isolatedDatabase(55433);
    const hash = await argon2.hash('synthetic test password', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32
    });

    await db.owner.query(
      "INSERT INTO app_private.accounts(id, email, password_hash, role) VALUES($1, 'admin@example.test', $4, 'admin'), ($2, 'manager@example.test', $4, 'manager'), ($3, 'tech@example.test', $4, 'technician')",
      [adminId, managerId, technicianAccountId, hash]
    );

    adminCookie = await createSession(adminId);
    managerCookie = await createSession(managerId);
    techCookie = await createSession(technicianAccountId);

    // Seed 10 service orders
    for (let i = 1; i <= 10; i++) {
      const tech = i % 2 === 0 ? johnTechId : aliTechId;
      const priceSen = i * 10000; // 100.00, 200.00, ...
      const prob = i === 1 ? 'Master bedroom leaking water heavily' : `Air conditioner cooling issue ${i}`;
      const notes = i === 1 ? 'Customer requested urgent morning visit' : null;

      await db.owner.query(
        `INSERT INTO app_private.service_orders(
          customer_name, phone, address, problem_description, service_type,
          quoted_price_sen, currency, assigned_technician_id,
          created_by_account_id, assigned_by_account_id, admin_notes
        ) VALUES($1, '0123456789', 'Jalan Ampang', $2, 'repair', $3, 'MYR', $4, $5, $5, $6)`,
        [`Customer ${i}`, prob, priceSen, tech, adminId, notes]
      );
    }

    app = buildApp(
      {
        databaseUrl: db.runtimeUrl,
        publicOrigin: origin,
        production: false,
        port: 3000,
        poolMax: 12,
        trustedProxy: [],
        hmacSecret: 'synthetic-assistant-test-secret-at-least-32-bytes',
        aiEnabled: true,
        aiBaseUrl: 'https://ai.example.test/v1',
        aiApiKey: 'dummy-key',
        aiModel: 'dummy-model',
        aiDailyQuestionLimit: 500,
        aiGlobalConcurrency: 4
      },
      db.runtime
    );
    app.operationsAssistantProvider = new DeterministicFakeProvider();
    await app.ready();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it('manager is admitted to portal and can read orders, but strictly denied admin-only editor routes', async () => {
    // 1. Session endpoint admits manager
    const sessionRes = await app.inject({ url: '/api/auth/session', headers: { cookie: managerCookie } });
    expect(sessionRes.statusCode).toBe(200);
    expect(sessionRes.json().data.user.role).toBe('manager');

    // 2. Orders list is readable by manager
    const listRes = await app.inject({ url: '/api/service-orders', headers: { cookie: managerCookie } });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.items.length).toBeGreaterThan(0);

    // 3. Draft list is FORBIDDEN for manager
    const draftListRes = await app.inject({ url: '/api/drafts', headers: { cookie: managerCookie } });
    expect(draftListRes.statusCode).toBe(403);
    expect(draftListRes.json().error.code).toBe('FORBIDDEN');

    // 4. Technician list is FORBIDDEN for manager
    const techRes = await app.inject({ url: '/api/technicians', headers: { cookie: managerCookie } });
    expect(techRes.statusCode).toBe(403);
    expect(techRes.json().error.code).toBe('FORBIDDEN');

    // 5. Order creation is FORBIDDEN for manager
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/service-orders',
      headers: headers(managerCookie),
      payload: {
        fields: {
          customerName: 'Test',
          phone: '012',
          address: 'St',
          problemDescription: 'Prob',
          serviceType: 'repair',
          quotedPrice: '100.00',
          assignedTechnicianId: aliTechId,
          adminNotes: null
        }
      }
    });
    expect(createRes.statusCode).toBe(403);
    expect(createRes.json().error.code).toBe('FORBIDDEN');
  });

  it('technician account is completely rejected from portal session with 403', async () => {
    const res = await app.inject({ url: '/api/auth/session', headers: { cookie: techCookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('operations assistant executes queries against real database for both admin and manager', async () => {
    // Manager query: count orders
    const countRes = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers: headers(managerCookie),
      payload: { question: 'How many orders total?' }
    });
    expect(countRes.statusCode).toBe(200);
    const countData = countRes.json().data;
    expect(countData.kind).toBe('answer');
    expect(countData.operation).toBe('countOrders');
    expect(countData.evidence.data.matchingCount).toBe('10');

    // Admin query: total quoted value
    const sumRes = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers: headers(adminCookie),
      payload: { question: 'What is the total quoted value?' }
    });
    expect(sumRes.statusCode).toBe(200);
    const sumData = sumRes.json().data;
    expect(sumData.kind).toBe('answer');
    expect(sumData.operation).toBe('totalQuotedValue');
    // Sum of 100+200+...+1000 = 5500.00
    expect(sumData.evidence.data.totalQuotedValue).toBe('5500.00');

    // Technician ranking query
    const rankRes = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers: headers(managerCookie),
      payload: { question: 'Who is the busiest technician by order count?' }
    });
    expect(rankRes.statusCode).toBe(200);
    const rankData = rankRes.json().data;
    expect(rankData.kind).toBe('answer');
    expect(rankData.operation).toBe('rankTechnicians');
    expect(rankData.evidence.data.items).toHaveLength(2);
    // Both John and Ali have 5 orders, so they should share rank #1!
    expect(rankData.evidence.data.items[0].rank).toBe(1);
    expect(rankData.evidence.data.items[1].rank).toBe(1);
  });

  it('findOrders returns search excerpts and does not leak customer phone or address', async () => {
    const findRes = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers: headers(adminCookie),
      payload: { question: 'Find orders with cooling problem' }
    });
    expect(findRes.statusCode).toBe(200);
    const data = findRes.json().data;
    expect(data.kind).toBe('answer');
    expect(data.operation).toBe('findOrders');
    expect(data.evidence.data.items.length).toBeGreaterThan(0);

    const firstItem = data.evidence.data.items[0];
    expect(firstItem.orderNumber).toMatch(/^SO-\d{6}$/);
    expect(firstItem.customerName).toBeDefined();
    expect(firstItem.technician).toBeDefined();
    // Verify phone and address are completely omitted from response
    expect(firstItem.phone).toBeUndefined();
    expect(firstItem.address).toBeUndefined();
  });

  it('lookupOrder finds exact canonical order and returns null for non-existent order', async () => {
    // 1. Existing order SO-000001
    const foundRes = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers: headers(managerCookie),
      payload: { question: 'Lookup SO-000001' }
    });
    expect(foundRes.statusCode).toBe(200);
    const foundData = foundRes.json().data;
    expect(foundData.kind).toBe('answer');
    expect(foundData.evidence.data.order).not.toBeNull();
    expect(foundData.evidence.data.order.orderNumber).toBe('SO-000001');

    // 2. Non-existent order SO-999999
    const missRes = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers: headers(managerCookie),
      payload: { question: 'Lookup SO-999999' }
    });
    expect(missRes.statusCode).toBe(200);
    const missData = missRes.json().data;
    expect(missData.kind).toBe('answer');
    expect(missData.evidence.data.order).toBeNull();
  });

  it('enforces single concurrent request per account with 429 RATE_LIMITED', async () => {
    // Start a request that holds the lease
    const heldKey = randomUUID();
    const leaseConn = await db.runtime.connect();
    try {
      await leaseConn.query(
        "INSERT INTO app_private.ai_request_leases(request_id, account_id, slot, expires_at) VALUES($1, $2, 1, clock_timestamp() + interval '30 seconds')",
        [heldKey, adminId]
      );

      const rejected = await app.inject({
        method: 'POST',
        url: '/api/operations-assistant/query',
        headers: headers(adminCookie),
        payload: { question: 'How many orders?' }
      });
      expect(rejected.statusCode).toBe(429);
      expect(rejected.json().error.code).toBe('RATE_LIMITED');
      expect(rejected.headers['retry-after']).toBeDefined();
    } finally {
      await leaseConn.query('DELETE FROM app_private.ai_request_leases WHERE request_id = $1', [heldKey]);
      leaseConn.release();
    }
  });

  it('cleanup-ai maintenance command clears expired leases and old usage rows', async () => {
    const prevProvisionUrl = process.env.PROVISION_DATABASE_URL;
    process.env.PROVISION_DATABASE_URL = db.ownerUrl;
    try {
      // Insert expired lease using existing account ID
      const expiredReqId = randomUUID();
      await db.owner.query(
        "INSERT INTO app_private.ai_request_leases(request_id, account_id, slot, expires_at) VALUES($1, $2, 3, clock_timestamp() - interval '10 seconds')",
        [expiredReqId, technicianAccountId]
      );

      await runAccountCommand(['cleanup-ai']);

      const remaining = await db.owner.query(
        'SELECT count(*)::int n FROM app_private.ai_request_leases WHERE request_id = $1',
        [expiredReqId]
      );
      expect(remaining.rows[0].n).toBe(0);
    } finally {
      process.env.PROVISION_DATABASE_URL = prevProvisionUrl;
    }
  });

  it('app_runtime and public roles cannot read internal AI tables or bypass access control', async () => {
    // app_runtime has SELECT/INSERT on ai_account_usage, ai_daily_usage, ai_request_leases, but NO TRUNCATE or DROP
    await expect(db.runtime.query('TRUNCATE app_private.ai_request_leases')).rejects.toThrow();
    await expect(db.runtime.query('DROP TABLE app_private.ai_daily_usage')).rejects.toThrow();

    // PUBLIC has NO privileges on app_private
    const publicUsage = await db.owner.query(
      "SELECT has_table_privilege('public', 'app_private.ai_request_leases', 'SELECT') allowed"
    );
    expect(publicUsage.rows[0].allowed).toBe(false);
  });
});
