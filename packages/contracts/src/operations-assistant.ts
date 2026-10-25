import { isUuid, normalizeUuid } from './service-orders.js';

export type AssistantOperation =
  | 'findOrders'
  | 'countOrders'
  | 'rankTechnicians'
  | 'totalQuotedValue'
  | 'lookupOrder';

export type ServiceType = 'installation' | 'servicing' | 'repair';
export type DateBasis = 'createdAt' | 'assignedAt';
export type RankingMetric = 'orderCount' | 'quotedValue';
export type SummarySource = 'ai' | 'deterministic';

export type QueryPlanFilters = {
  technicianId: string | null;
  serviceType: ServiceType | null;
  dateBasis: DateBasis;
  startDate: string | null; // explicit MYT YYYY-MM-DD
  endDate: string | null;   // inclusive calendar date YYYY-MM-DD
  customerName: string | null;
  serviceText: string | null;
};

export type QueryPlan = {
  operation: AssistantOperation;
  filters: QueryPlanFilters;
  orderNumber: string | null;
  rankingMetric: RankingMetric | null;
};

export type RecentExchange = {
  question: string;
  narrative: string;
};

export type AssistantQueryRequest = {
  question: string;
  recentExchanges: RecentExchange[];
  previousQuery: QueryPlan | null;
};

export type ResolvedFilters = {
  technician: { id: string; name: string } | null;
  serviceType: ServiceType | null;
  dateBasis: DateBasis;
  intervalLabel: string;
  startDate: string | null;
  endDate: string | null;
  startUtc: string | null;
  endUtc: string | null;
  customerName: string | null;
  serviceText: string | null;
};

export type OperationalOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  serviceType: ServiceType;
  technician: { id: string; name: string };
  status: 'assigned';
  quotedPrice: { currency: 'MYR'; amount: string };
  createdAt: string;
  assignedAt: string;
  excerpts?: {
    problemDescription?: string;
    adminNotes?: string;
  };
};

export type RankingItem = {
  technician: { id: string; name: string };
  rank: number;
  orderCount: string;
  totalQuotedValue: string;
};

export type FindOrdersEvidence = {
  items: OperationalOrder[];
  matchingCount: string;
  returnedCount: number;
  truncated: boolean;
};

export type CountOrdersEvidence = {
  matchingCount: string;
};

export type TotalQuotedValueEvidence = {
  matchingCount: string;
  totalQuotedValue: string;
};

export type RankTechniciansEvidence = {
  items: RankingItem[];
  metric: RankingMetric;
};

export type LookupOrderEvidence = {
  order: OperationalOrder | null;
};

export type AssistantEvidence =
  | { kind: 'findOrders'; data: FindOrdersEvidence }
  | { kind: 'countOrders'; data: CountOrdersEvidence }
  | { kind: 'totalQuotedValue'; data: TotalQuotedValueEvidence }
  | { kind: 'rankTechnicians'; data: RankTechniciansEvidence }
  | { kind: 'lookupOrder'; data: LookupOrderEvidence };

export type ClarificationResponse = {
  kind: 'clarification';
  message: string;
  choices?: Array<{ label: string; question: string }>;
};

export type UnsupportedResponse = {
  kind: 'unsupported';
  message: string;
  suggestions?: Array<{ label: string; question: string }>;
};

export type AnswerResponse = {
  kind: 'answer';
  operation: AssistantOperation;
  query: QueryPlan;
  resolvedFilters: ResolvedFilters;
  retrievedAt: string;
  narrative: string;
  summarySource: SummarySource;
  evidence: AssistantEvidence;
};

export type AssistantResponse =
  | ClarificationResponse
  | UnsupportedResponse
  | AnswerResponse;

export type ProviderInterpretationResult =
  | { kind: 'query'; plan: QueryPlan }
  | ClarificationResponse
  | UnsupportedResponse;

// Minimal factual DTO for external provider prompt - strictly NO PII, no excerpts, no DB UUIDs
export type ProviderOrderRow = {
  orderNumber: string;
  serviceType: ServiceType;
  technicianName: string;
  quote: string;
  createdAtMyt: string;
  assignedAtMyt: string;
};

export type ProviderRankingRow = {
  technicianName: string;
  rank: number;
  orderCount: string;
  totalQuotedValue: string;
};

export type ProviderRetrievalDto = {
  operation: AssistantOperation;
  filters: {
    technicianName: string | null;
    serviceType: ServiceType | null;
    dateBasis: DateBasis;
    mytInterval: string;
    customerNameSearch: string | null;
    serviceTextSearch: string | null;
  };
  matchingCount: string;
  totalQuotedValue?: string;
  rankingMetric?: RankingMetric;
  rankings?: ProviderRankingRow[];
  orderRows?: ProviderOrderRow[];
  orderLookup?: {
    found: boolean;
    orderNumber?: string;
    serviceType?: ServiceType;
    technicianName?: string;
    quote?: string;
    createdAtMyt?: string;
    assignedAtMyt?: string;
  } | null;
};

// --- Canonical string & validation helpers ---

export function isCanonicalOrderNumber(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^SO-(\d{6,})$/i.exec(value.trim());
  if (!match) return false;
  const digits = match[1]!;
  if (digits.length > 6 && digits.startsWith('0')) return false;
  return true;
}

export function normalizeOrderNumber(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return isCanonicalOrderNumber(trimmed) ? trimmed : null;
}

export function parseOrderNumberValue(orderNumber: string): bigint {
  const match = /^SO-(\d+)$/i.exec(orderNumber.trim());
  if (!match) throw new Error('Invalid order number');
  return BigInt(match[1]!);
}

export function formatOrderNumber(seqValue: bigint | number): string {
  const str = seqValue.toString();
  return `SO-${str.padStart(6, '0')}`;
}

export function isValidSearchTerm(term: unknown): term is string {
  if (typeof term !== 'string') return false;
  const anyTerm = term as any;
  if (typeof anyTerm.isWellFormed === 'function') {
    if (!anyTerm.isWellFormed()) return false;
  } else if (/[\uD800-\uDFFF]/.test(term)) {
    return false;
  }
  if (term.includes('\0')) return false;
  const trimmed = term.trim();
  if (trimmed !== term) return false;
  const len = [...term].length;
  return len >= 2 && len <= 200;
}

export function escapeSqlLike(term: string): string {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

export function extractExcerpt(fullText: string, searchTerm: string): string | null {
  if (!fullText || !searchTerm) return null;
  const lowerText = fullText.toLowerCase();
  const lowerTerm = searchTerm.toLowerCase();
  const matchIdx = lowerText.indexOf(lowerTerm);
  if (matchIdx === -1) return null;

  // Code point array for safe Unicode windowing
  const chars = [...fullText];
  const termLen = [...searchTerm].length;

  // Map byte/char index to code point index
  let codePointMatchIdx = 0;
  let charCount = 0;
  for (let i = 0; i < chars.length; i++) {
    if (charCount >= matchIdx) {
      codePointMatchIdx = i;
      break;
    }
    charCount += chars[i]!.length;
  }

  const maxTotalLen = 160;
  const matchEndIdx = codePointMatchIdx + termLen;

  // Window bounds
  let start = Math.max(0, codePointMatchIdx - 50);
  let end = Math.min(chars.length, matchEndIdx + 90);

  // Adjust to fit maxTotalLen
  if (end - start > maxTotalLen - 6) {
    end = start + maxTotalLen - 6;
    if (end < matchEndIdx) {
      end = Math.min(chars.length, matchEndIdx + 20);
      start = Math.max(0, end - (maxTotalLen - 6));
    }
  }

  const hasLeadingEllipsis = start > 0;
  const hasTrailingEllipsis = end < chars.length;

  const prefix = hasLeadingEllipsis ? '...' : '';
  const suffix = hasTrailingEllipsis ? '...' : '';
  const body = chars.slice(start, end).join('');

  return `${prefix}${body}${suffix}`;
}

// --- Date validation and MYT period canonicalization ---

export function isValidMytDateString(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

// Convert instant to Asia/Kuala_Lumpur (UTC+8) civil date components
export function getMytDateParts(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number; mytDay: string } {
  // Asia/Kuala_Lumpur has constant offset UTC+8 without daylight saving time
  const mytMillis = instant.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(mytMillis);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();
  const mytDay = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return { year, month, day, hour, minute, second, mytDay };
}

// Convert MYT calendar date to UTC start of day instant
export function mytDateToStartUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Midnight MYT is 16:00:00 UTC previous day (UTC - 8h)
  return new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0) - 8 * 60 * 60 * 1000);
}

// Convert MYT calendar date to UTC end of day instant (start of next day, exclusive)
export function mytDateToEndUtcExclusive(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Next day midnight MYT minus 8 hours
  return new Date(Date.UTC(y!, m! - 1, d! + 1, 0, 0, 0) - 8 * 60 * 60 * 1000);
}

// Resolve relative date periods using captured server instant
export type RelativePeriod = 'today' | 'this_week' | 'last_week' | 'this_month';

export function resolveMytPeriod(
  period: RelativePeriod,
  nowInstant: Date
): { startDate: string; endDate: string; startUtc: Date; endUtc: Date; label: string } {
  const myt = getMytDateParts(nowInstant);

  if (period === 'today') {
    const startDate = myt.mytDay;
    const endDate = myt.mytDay;
    const startUtc = mytDateToStartUtc(startDate);
    const endUtc = nowInstant; // up to captured now
    return { startDate, endDate, startUtc, endUtc, label: `Today (${startDate})` };
  }

  if (period === 'this_week') {
    // MYT day of week: Sunday = 0, Monday = 1, ..., Saturday = 6
    const mytDate = new Date(Date.UTC(myt.year, myt.month - 1, myt.day));
    const dayOfWeek = mytDate.getUTCDay(); // 0-6
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monDate = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday));
    const monYear = monDate.getUTCFullYear();
    const monMonth = (monDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const monDay = monDate.getUTCDate().toString().padStart(2, '0');
    const startDate = `${monYear}-${monMonth}-${monDay}`;
    const endDate = myt.mytDay;
    const startUtc = mytDateToStartUtc(startDate);
    const endUtc = nowInstant;
    return { startDate, endDate, startUtc, endUtc, label: `This week (${startDate} to ${endDate})` };
  }

  if (period === 'last_week') {
    const mytDate = new Date(Date.UTC(myt.year, myt.month - 1, myt.day));
    const dayOfWeek = mytDate.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const prevMon = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday - 7));
    const currMon = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday));
    const prevSun = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday - 1));

    const startDate = `${prevMon.getUTCFullYear()}-${(prevMon.getUTCMonth() + 1).toString().padStart(2, '0')}-${prevMon.getUTCDate().toString().padStart(2, '0')}`;
    const endDate = `${prevSun.getUTCFullYear()}-${(prevSun.getUTCMonth() + 1).toString().padStart(2, '0')}-${prevSun.getUTCDate().toString().padStart(2, '0')}`;
    const startUtc = mytDateToStartUtc(startDate);
    const endUtc = mytDateToStartUtc(`${currMon.getUTCFullYear()}-${(currMon.getUTCMonth() + 1).toString().padStart(2, '0')}-${currMon.getUTCDate().toString().padStart(2, '0')}`);
    return { startDate, endDate, startUtc, endUtc, label: `Last week (${startDate} to ${endDate})` };
  }

  // this_month
  const startDate = `${myt.year}-${myt.month.toString().padStart(2, '0')}-01`;
  const endDate = myt.mytDay;
  const startUtc = mytDateToStartUtc(startDate);
  const endUtc = nowInstant;
  return { startDate, endDate, startUtc, endUtc, label: `This month (${startDate} to ${endDate})` };
}

export function validateQueryPlan(plan: unknown): { valid: true; plan: QueryPlan } | { valid: false; error: string } {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, error: 'QueryPlan must be an object' };
  }

  const p = plan as Record<string, unknown>;
  const allowedOps: AssistantOperation[] = ['findOrders', 'countOrders', 'rankTechnicians', 'totalQuotedValue', 'lookupOrder'];
  if (!allowedOps.includes(p.operation as AssistantOperation)) {
    return { valid: false, error: `Invalid operation: ${String(p.operation)}` };
  }
  const operation = p.operation as AssistantOperation;

  if (!p.filters || typeof p.filters !== 'object' || Array.isArray(p.filters)) {
    return { valid: false, error: 'filters must be an object' };
  }
  const f = p.filters as Record<string, unknown>;

  // Technician ID
  let technicianId: string | null = null;
  if (f.technicianId !== null && f.technicianId !== undefined) {
    if (typeof f.technicianId !== 'string' || !isUuid(f.technicianId)) {
      return { valid: false, error: 'technicianId must be a valid UUID or null' };
    }
    technicianId = normalizeUuid(f.technicianId);
  }

  // Service Type
  let serviceType: ServiceType | null = null;
  if (f.serviceType !== null && f.serviceType !== undefined) {
    if (!['installation', 'servicing', 'repair'].includes(f.serviceType as string)) {
      return { valid: false, error: 'serviceType must be installation, servicing, repair, or null' };
    }
    serviceType = f.serviceType as ServiceType;
  }

  // Date Basis
  if (f.dateBasis !== 'createdAt' && f.dateBasis !== 'assignedAt') {
    return { valid: false, error: 'dateBasis must be createdAt or assignedAt' };
  }
  const dateBasis = f.dateBasis as DateBasis;

  // Dates: both null or both valid YYYY-MM-DD with start <= end
  let startDate: string | null = null;
  let endDate: string | null = null;
  const hasStart = f.startDate !== null && f.startDate !== undefined;
  const hasEnd = f.endDate !== null && f.endDate !== undefined;

  if (hasStart !== hasEnd) {
    return { valid: false, error: 'startDate and endDate must both be null or both be calendar dates' };
  }

  if (hasStart && hasEnd) {
    if (!isValidMytDateString(f.startDate)) {
      return { valid: false, error: 'startDate must be a valid YYYY-MM-DD date' };
    }
    if (!isValidMytDateString(f.endDate)) {
      return { valid: false, error: 'endDate must be a valid YYYY-MM-DD date' };
    }
    if (f.startDate > f.endDate) {
      return { valid: false, error: 'startDate must be before or equal to endDate' };
    }
    startDate = f.startDate as string;
    endDate = f.endDate as string;
  }

  // Search terms
  let customerName: string | null = null;
  if (f.customerName !== null && f.customerName !== undefined) {
    if (!isValidSearchTerm(f.customerName)) {
      return { valid: false, error: 'customerName search term must be 2-200 code points, trimmed, without surrogates or NUL' };
    }
    customerName = f.customerName as string;
  }

  let serviceText: string | null = null;
  if (f.serviceText !== null && f.serviceText !== undefined) {
    if (!isValidSearchTerm(f.serviceText)) {
      return { valid: false, error: 'serviceText search term must be 2-200 code points, trimmed, without surrogates or NUL' };
    }
    serviceText = f.serviceText as string;
  }

  // orderNumber
  let orderNumber: string | null = null;
  if (operation === 'lookupOrder') {
    if (!p.orderNumber || !isCanonicalOrderNumber(p.orderNumber)) {
      return { valid: false, error: 'lookupOrder requires canonical orderNumber (e.g. SO-000001)' };
    }
    orderNumber = normalizeOrderNumber(p.orderNumber as string);
  } else {
    if (p.orderNumber !== null && p.orderNumber !== undefined) {
      return { valid: false, error: 'orderNumber must be null for operations other than lookupOrder' };
    }
  }

  // rankingMetric
  let rankingMetric: RankingMetric | null = null;
  if (operation === 'rankTechnicians') {
    if (p.rankingMetric !== 'orderCount' && p.rankingMetric !== 'quotedValue') {
      return { valid: false, error: 'rankTechnicians requires rankingMetric (orderCount or quotedValue)' };
    }
    rankingMetric = p.rankingMetric as RankingMetric;
  } else {
    if (p.rankingMetric !== null && p.rankingMetric !== undefined) {
      return { valid: false, error: 'rankingMetric must be null for operations other than rankTechnicians' };
    }
  }

  return {
    valid: true,
    plan: {
      operation,
      filters: {
        technicianId,
        serviceType,
        dateBasis,
        startDate,
        endDate,
        customerName,
        serviceText
      },
      orderNumber,
      rankingMetric
    }
  };
}

export function validateAssistantRequest(body: unknown): { valid: true; request: AssistantQueryRequest } | { valid: false; error: string; code: 'MALFORMED_REQUEST' | 'VALIDATION_ERROR' } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object', code: 'MALFORMED_REQUEST' };
  }

  const b = body as Record<string, unknown>;

  // Check unknown top-level properties
  const allowedKeys = ['question', 'recentExchanges', 'previousQuery'];
  for (const k of Object.keys(b)) {
    if (!allowedKeys.includes(k)) {
      return { valid: false, error: `Unknown request property: ${k}`, code: 'MALFORMED_REQUEST' };
    }
  }

  // Question validation
  if (typeof b.question !== 'string') {
    return { valid: false, error: 'question must be a string', code: 'MALFORMED_REQUEST' };
  }
  const questionTrimmed = b.question.trim();
  if (questionTrimmed.length === 0) {
    return { valid: false, error: 'Question cannot be empty or whitespace only', code: 'VALIDATION_ERROR' };
  }
  const qLen = [...b.question].length;
  if (qLen > 2000) {
    return { valid: false, error: 'Question exceeds maximum length of 2000 characters', code: 'VALIDATION_ERROR' };
  }

  // Recent exchanges validation
  const rawExchanges = b.recentExchanges ?? [];
  if (!Array.isArray(rawExchanges)) {
    return { valid: false, error: 'recentExchanges must be an array', code: 'MALFORMED_REQUEST' };
  }
  if (rawExchanges.length > 6) {
    return { valid: false, error: 'recentExchanges cannot contain more than 6 exchanges', code: 'VALIDATION_ERROR' };
  }

  const recentExchanges: RecentExchange[] = [];
  let totalContextLen = qLen;

  for (const ex of rawExchanges) {
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) {
      return { valid: false, error: 'Each exchange must be an object', code: 'MALFORMED_REQUEST' };
    }
    const exObj = ex as Record<string, unknown>;
    for (const ek of Object.keys(exObj)) {
      if (!['question', 'narrative'].includes(ek)) {
        return { valid: false, error: `Unknown exchange property: ${ek}`, code: 'MALFORMED_REQUEST' };
      }
    }
    if (typeof exObj.question !== 'string' || typeof exObj.narrative !== 'string') {
      return { valid: false, error: 'Exchange question and narrative must be strings', code: 'MALFORMED_REQUEST' };
    }
    const eqLen = [...exObj.question].length;
    const enLen = [...exObj.narrative].length;
    if (eqLen > 2000) {
      return { valid: false, error: 'Exchange question exceeds 2000 characters', code: 'VALIDATION_ERROR' };
    }
    if (enLen > 4000) {
      return { valid: false, error: 'Exchange narrative exceeds 4000 characters', code: 'VALIDATION_ERROR' };
    }
    totalContextLen += eqLen + enLen;
    recentExchanges.push({ question: exObj.question, narrative: exObj.narrative });
  }

  // Previous query validation
  let previousQuery: QueryPlan | null = null;
  const rawPrevious = b.previousQuery ?? null;
  if (rawPrevious !== null) {
    const validated = validateQueryPlan(rawPrevious);
    if (!validated.valid) {
      return { valid: false, error: `Invalid previousQuery: ${validated.error}`, code: 'MALFORMED_REQUEST' };
    }
    previousQuery = validated.plan;
    totalContextLen += JSON.stringify(previousQuery).length;
  }

  if (totalContextLen > 16000) {
    return { valid: false, error: 'Combined context exceeds maximum limit of 16000 characters', code: 'VALIDATION_ERROR' };
  }

  return {
    valid: true,
    request: {
      question: b.question,
      recentExchanges,
      previousQuery
    }
  };
}
