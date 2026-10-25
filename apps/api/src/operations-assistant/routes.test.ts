import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import { AppError } from '../errors.js';
import type { Actor } from '@sejuk/contracts/api';
import type { AiProvider } from './provider.js';
import { DeterministicFakeProvider } from './provider.js';

vi.mock('../auth/index.js', () => ({
  requireOrderReader: vi.fn(),
  requireAdmin: vi.fn(),
  authorizeAdmin: vi.fn(),
  authorizeOrderReader: vi.fn(),
  getSessionToken: () => 'dev-token',
  resolveSession: vi.fn()
}));

vi.mock('./admission.js', () => ({
  admitQueryRequest: vi.fn(),
  releaseAdmissionLease: vi.fn()
}));

vi.mock('./plans.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plans.js')>();
  return {
    ...actual,
    loadTechniciansReference: vi.fn().mockResolvedValue([
      { id: '10000000-0000-4000-8000-000000000001', name: 'Ali', isActive: true },
      { id: '10000000-0000-4000-8000-000000000002', name: 'John', isActive: true },
      { id: '10000000-0000-4000-8000-000000000003', name: 'Bala', isActive: true },
      { id: '10000000-0000-4000-8000-000000000004', name: 'Yusoff', isActive: true }
    ])
  };
});

vi.mock('./queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries.js')>();
  return {
    ...actual,
    executeAssistantQuery: vi.fn().mockImplementation(async (_pool, plan) => {
      if (plan.operation === 'countOrders') {
        return { kind: 'countOrders', data: { matchingCount: '42' } };
      }
      if (plan.operation === 'totalQuotedValue') {
        return { kind: 'totalQuotedValue', data: { matchingCount: '5', totalQuotedValue: '750.00' } };
      }
      if (plan.operation === 'rankTechnicians') {
        return {
          kind: 'rankTechnicians',
          data: {
            items: [
              { technician: { id: '10000000-0000-4000-8000-000000000002', name: 'John' }, rank: 1, orderCount: '15', totalQuotedValue: '2250.00' },
              { technician: { id: '10000000-0000-4000-8000-000000000001', name: 'Ali' }, rank: 2, orderCount: '10', totalQuotedValue: '1500.00' }
            ],
            metric: plan.rankingMetric ?? 'orderCount'
          }
        };
      }
      if (plan.operation === 'lookupOrder') {
        return {
          kind: 'lookupOrder',
          data: {
            order: {
              id: '30000000-0000-4000-8000-000000000001',
              orderNumber: 'SO-000001',
              customerName: 'Tan Ah Kow',
              serviceType: 'repair',
              technician: { id: '10000000-0000-4000-8000-000000000001', name: 'Ali' },
              status: 'assigned',
              quotedPrice: { currency: 'MYR', amount: '150.00' },
              createdAt: '2026-10-24T00:00:00.000Z',
              assignedAt: '2026-10-24T00:00:00.000Z'
            }
          }
        };
      }
      return {
        kind: 'findOrders',
        data: {
          items: [],
          matchingCount: '0',
          returnedCount: 0,
          truncated: false
        }
      };
    })
  };
});

import { requireOrderReader } from '../auth/index.js';
import { admitQueryRequest, releaseAdmissionLease } from './admission.js';

describe('Operations Assistant API routes', () => {
  const origin = 'http://localhost:5173';
  const headers = {
    origin,
    'x-csrf-protection': '1',
    'content-type': 'application/json'
  };

  const dummyActor: Actor = { accountId: '50000000-0000-4000-8000-000000000001', role: 'admin' };
  const mockPool = { query: vi.fn(), end: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOrderReader).mockResolvedValue(dummyActor);
    vi.mocked(admitQueryRequest).mockResolvedValue({
      requestId: 'test-req',
      accountId: dummyActor.accountId,
      slot: 1
    });
    vi.mocked(releaseAdmissionLease).mockResolvedValue();
  });

  function createTestApp(provider?: AiProvider) {
    const app = buildApp(
      {
        databaseUrl: 'postgresql://synthetic:dummy@localhost:5432/synthetic',
        publicOrigin: origin,
        production: false,
        port: 3000,
        poolMax: 10,
        trustedProxy: [],
        hmacSecret: 'synthetic-test-only-secret-at-least-32-bytes',
        aiEnabled: true,
        aiBaseUrl: 'https://ai.example.test/v1',
        aiApiKey: 'test-key',
        aiModel: 'test-model'
      },
      mockPool
    );
    if (provider) {
      app.operationsAssistantProvider = provider;
    }
    return app;
  }

  it('rejects unauthenticated requests before body parsing', async () => {
    vi.mocked(requireOrderReader).mockRejectedValueOnce(
      new AppError(401, 'UNAUTHENTICATED', 'Your session has expired.')
    );
    const app = createTestApp(new DeterministicFakeProvider());
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers,
      payload: { question: 'How many orders?' }
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
    expect(admitQueryRequest).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects missing or invalid CSRF header', async () => {
    const app = createTestApp(new DeterministicFakeProvider());
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers: { ...headers, 'x-csrf-protection': '0' },
      payload: { question: 'How many orders?' }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_REJECTED');
    expect(admitQueryRequest).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects empty or whitespace-only questions with 422 VALIDATION_ERROR', async () => {
    const app = createTestApp(new DeterministicFakeProvider());
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers,
      payload: { question: '   ' }
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(admitQueryRequest).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects unknown request properties with 400 MALFORMED_REQUEST', async () => {
    const app = createTestApp(new DeterministicFakeProvider());
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers,
      payload: { question: 'How many?', maliciousField: true }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('MALFORMED_REQUEST');
    expect(admitQueryRequest).not.toHaveBeenCalled();
    await app.close();
  });

  it('handles clarification response without calling retrieval', async () => {
    const app = createTestApp(new DeterministicFakeProvider());
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers,
      payload: { question: 'Show orders for Ahmad' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.kind).toBe('clarification');
    expect(body.data.choices).toBeDefined();
    expect(admitQueryRequest).toHaveBeenCalledTimes(1);
    expect(releaseAdmissionLease).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('handles unsupported requests clearly', async () => {
    const app = createTestApp(new DeterministicFakeProvider());
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers,
      payload: { question: 'How many orders were completed today?' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.kind).toBe('unsupported');
    expect(body.data.suggestions).toBeDefined();
    expect(admitQueryRequest).toHaveBeenCalledTimes(1);
    expect(releaseAdmissionLease).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('executes countOrders and returns grounded answer with authoritative evidence', async () => {
    const app = createTestApp(new DeterministicFakeProvider());
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers,
      payload: { question: 'How many orders were created this month?' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.kind).toBe('answer');
    expect(body.data.operation).toBe('countOrders');
    expect(body.data.evidence.kind).toBe('countOrders');
    expect(body.data.evidence.data.matchingCount).toBe('42');
    expect(body.data.resolvedFilters).toBeDefined();
    expect(admitQueryRequest).toHaveBeenCalledTimes(1);
    expect(releaseAdmissionLease).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('falls back to deterministic summary when provider fails summary call', async () => {
    const failingSummaryProvider: AiProvider = {
      interpretQuestion: async () => ({
        kind: 'query',
        plan: {
          operation: 'totalQuotedValue',
          filters: {
            technicianId: null,
            serviceType: null,
            dateBasis: 'createdAt',
            startDate: null,
            endDate: null,
            customerName: null,
            serviceText: null
          },
          orderNumber: null,
          rankingMetric: null
        }
      }),
      generateSummary: async () => {
        throw new Error('Provider outage');
      }
    };

    const app = createTestApp(failingSummaryProvider);
    const res = await app.inject({
      method: 'POST',
      url: '/api/operations-assistant/query',
      headers,
      payload: { question: 'What is the total quoted value?' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.kind).toBe('answer');
    expect(body.data.summarySource).toBe('deterministic');
    expect(body.data.narrative).toContain('Total quoted value');
    expect(body.data.evidence.kind).toBe('totalQuotedValue');
    expect(body.data.evidence.data.totalQuotedValue).toBe('750.00');
    await app.close();
  });
});

