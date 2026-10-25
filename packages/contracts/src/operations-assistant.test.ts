import { describe, it, expect } from 'vitest';
import {
  isCanonicalOrderNumber,
  normalizeOrderNumber,
  parseOrderNumberValue,
  formatOrderNumber,
  isValidSearchTerm,
  escapeSqlLike,
  extractExcerpt,
  isValidMytDateString,
  getMytDateParts,
  mytDateToStartUtc,
  mytDateToEndUtcExclusive,
  resolveMytPeriod,
  validateQueryPlan,
  validateAssistantRequest,
  type QueryPlan
} from './operations-assistant.js';

describe('operations-assistant contracts', () => {
  describe('canonical order number validation', () => {
    it('accepts valid SO- numbers with at least 6 digits', () => {
      expect(isCanonicalOrderNumber('SO-000001')).toBe(true);
      expect(isCanonicalOrderNumber('SO-000042')).toBe(true);
      expect(isCanonicalOrderNumber('SO-999999')).toBe(true);
      expect(isCanonicalOrderNumber('SO-1000000')).toBe(true);
      expect(isCanonicalOrderNumber('so-000001')).toBe(true);
    });

    it('rejects numbers with fewer than 6 digits', () => {
      expect(isCanonicalOrderNumber('SO-1')).toBe(false);
      expect(isCanonicalOrderNumber('SO-0001')).toBe(false);
      expect(isCanonicalOrderNumber('SO-12345')).toBe(false);
    });

    it('rejects redundant leading zeros beyond 6 digits', () => {
      // 7 digits starting with 0 is redundant
      expect(isCanonicalOrderNumber('SO-0000001')).toBe(false);
      expect(isCanonicalOrderNumber('SO-0100000')).toBe(false);
    });

    it('normalizes case-insensitive user spelling and parses bigints correctly', () => {
      expect(normalizeOrderNumber(' so-000042 ')).toBe('SO-000042');
      expect(normalizeOrderNumber('invalid')).toBe(null);
      expect(parseOrderNumberValue('SO-000001')).toBe(1n);
      expect(parseOrderNumberValue('SO-9007199254740993')).toBe(9007199254740993n);
      expect(formatOrderNumber(1n)).toBe('SO-000001');
      expect(formatOrderNumber(1234567n)).toBe('SO-1234567');
    });
  });

  describe('search term validation and escaping', () => {
    it('accepts valid 2-200 code point search terms', () => {
      expect(isValidSearchTerm('AC')).toBe(true);
      expect(isValidSearchTerm('Daikin Inverter')).toBe(true);
      expect(isValidSearchTerm('Aircond leaking water')).toBe(true);
      expect(isValidSearchTerm('a'.repeat(200))).toBe(true);
    });

    it('rejects search terms that are too short, too long, untrimmed, or contain NUL', () => {
      expect(isValidSearchTerm('a')).toBe(false);
      expect(isValidSearchTerm('a'.repeat(201))).toBe(false);
      expect(isValidSearchTerm(' Daikin')).toBe(false);
      expect(isValidSearchTerm('Daikin ')).toBe(false);
      expect(isValidSearchTerm('Daikin\0')).toBe(false);
      expect(isValidSearchTerm(null)).toBe(false);
    });

    it('escapes SQL LIKE characters correctly', () => {
      expect(escapeSqlLike('100% cooling')).toBe('100\\% cooling');
      expect(escapeSqlLike('room_1')).toBe('room\\_1');
      expect(escapeSqlLike('C:\\path')).toBe('C:\\\\path');
      expect(escapeSqlLike('50%_discount\\deal')).toBe('50\\%\\_discount\\\\deal');
    });

    it('extracts excerpts within 160 code points centered on match', () => {
      const full = 'The customer called reporting that the master bedroom air conditioning unit is leaking water heavily onto the wooden flooring and needs urgent servicing.';
      const excerpt = extractExcerpt(full, 'leaking water');
      expect(excerpt).not.toBeNull();
      expect(excerpt).toContain('leaking water');
      expect([...excerpt!].length).toBeLessThanOrEqual(160);

      // No match
      expect(extractExcerpt(full, 'compressor')).toBeNull();
    });
  });

  describe('MYT date handling', () => {
    it('validates calendar dates strictly, rejecting leap year errors', () => {
      expect(isValidMytDateString('2026-10-24')).toBe(true);
      expect(isValidMytDateString('2024-02-29')).toBe(true); // leap year
      expect(isValidMytDateString('2025-02-29')).toBe(false); // not leap year
      expect(isValidMytDateString('2026-04-31')).toBe(false); // April has 30 days
      expect(isValidMytDateString('invalid')).toBe(false);
    });

    it('resolves relative periods using server captured instant', () => {
      // 2026-10-24 15:30:00 MYT is 2026-10-24 07:30:00 UTC (Saturday)
      const now = new Date(Date.UTC(2026, 9, 24, 7, 30, 0));
      const parts = getMytDateParts(now);
      expect(parts.mytDay).toBe('2026-10-24');
      expect(parts.hour).toBe(15);

      const today = resolveMytPeriod('today', now);
      expect(today.startDate).toBe('2026-10-24');
      expect(today.endDate).toBe('2026-10-24');
      expect(today.endUtc).toEqual(now);

      // This week: Monday Oct 19 to Saturday Oct 24
      const thisWeek = resolveMytPeriod('this_week', now);
      expect(thisWeek.startDate).toBe('2026-10-19');
      expect(thisWeek.endDate).toBe('2026-10-24');

      // Last week: Monday Oct 12 to Sunday Oct 18
      const lastWeek = resolveMytPeriod('last_week', now);
      expect(lastWeek.startDate).toBe('2026-10-12');
      expect(lastWeek.endDate).toBe('2026-10-18');

      // This month: Oct 01 to Oct 24
      const thisMonth = resolveMytPeriod('this_month', now);
      expect(thisMonth.startDate).toBe('2026-10-01');
      expect(thisMonth.endDate).toBe('2026-10-24');
    });

    it('correctly maps MYT midnight to UTC', () => {
      // 2026-10-24 00:00:00 MYT -> 2026-10-23 16:00:00 UTC
      const startUtc = mytDateToStartUtc('2026-10-24');
      expect(startUtc.toISOString()).toBe('2026-10-23T16:00:00.000Z');

      const endUtcExclusive = mytDateToEndUtcExclusive('2026-10-24');
      expect(endUtcExclusive.toISOString()).toBe('2026-10-24T16:00:00.000Z');
    });
  });

  describe('query plan and request validation', () => {
    const validPlan: QueryPlan = {
      operation: 'findOrders',
      filters: {
        technicianId: null,
        serviceType: 'repair',
        dateBasis: 'createdAt',
        startDate: '2026-10-01',
        endDate: '2026-10-24',
        customerName: 'Tan',
        serviceText: 'cooling'
      },
      orderNumber: null,
      rankingMetric: null
    };

    it('accepts valid query plan', () => {
      const result = validateQueryPlan(validPlan);
      expect(result.valid).toBe(true);
    });

    it('rejects mismatched operation and parameters', () => {
      // orderNumber on findOrders is rejected
      expect(validateQueryPlan({ ...validPlan, orderNumber: 'SO-000001' }).valid).toBe(false);
      // rankingMetric on countOrders is rejected
      expect(validateQueryPlan({ ...validPlan, operation: 'countOrders', rankingMetric: 'orderCount' }).valid).toBe(false);
      // rankTechnicians requires rankingMetric
      expect(validateQueryPlan({ ...validPlan, operation: 'rankTechnicians' }).valid).toBe(false);
      // lookupOrder requires orderNumber
      expect(validateQueryPlan({ ...validPlan, operation: 'lookupOrder' }).valid).toBe(false);
      // lookupOrder with valid orderNumber
      expect(validateQueryPlan({ ...validPlan, operation: 'lookupOrder', orderNumber: 'SO-000001' }).valid).toBe(true);
    });

    it('validates assistant request body limits and properties', () => {
      const validReq = {
        question: 'How many repair orders were created this month?',
        recentExchanges: [
          { question: 'Who is the busiest tech?', narrative: 'John has 10 orders.' }
        ],
        previousQuery: validPlan
      };

      const result = validateAssistantRequest(validReq);
      expect(result.valid).toBe(true);

      // Rejects whitespace-only question
      expect(validateAssistantRequest({ ...validReq, question: '   ' }).valid).toBe(false);

      // Rejects unknown property
      expect(validateAssistantRequest({ ...validReq, unknownProp: 123 }).valid).toBe(false);

      // Rejects more than 6 exchanges
      const sevenExchanges = Array(7).fill({ question: 'q', narrative: 'n' });
      expect(validateAssistantRequest({ ...validReq, recentExchanges: sevenExchanges }).valid).toBe(false);
    });
  });
});

