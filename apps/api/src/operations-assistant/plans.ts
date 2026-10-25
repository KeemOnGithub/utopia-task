import type { Queryable } from '../db.js';
import {
  type QueryPlan,
  type ResolvedFilters,
  isValidMytDateString,
  mytDateToEndUtcExclusive,
  mytDateToStartUtc,
  resolveMytPeriod
} from '../../../../packages/contracts/src/operations-assistant.js';

export type TechnicianRef = {
  id: string;
  name: string;
  isActive: boolean;
};

export async function loadTechniciansReference(db: Queryable): Promise<TechnicianRef[]> {
  const res = await db.query(
    'SELECT id, display_name, is_active FROM app_private.technicians ORDER BY display_name ASC'
  );
  return res.rows.map((r: { id: string; display_name: string; is_active: boolean }) => ({
    id: r.id,
    name: r.display_name,
    isActive: r.is_active
  }));
}

export function resolveTechnicianName(
  inputName: string,
  technicians: TechnicianRef[]
): { resolved: TechnicianRef | null; ambiguous: boolean; candidateNames: string[] } {
  const norm = inputName.trim().toLowerCase();
  if (!norm) return { resolved: null, ambiguous: false, candidateNames: [] };

  // 1. Exact case-insensitive match
  const exact = technicians.filter(t => t.name.toLowerCase() === norm);
  if (exact.length === 1) {
    return { resolved: exact[0]!, ambiguous: false, candidateNames: [exact[0]!.name] };
  }
  if (exact.length > 1) {
    return { resolved: null, ambiguous: true, candidateNames: exact.map(t => t.name) };
  }

  // 2. Substring match
  const partial = technicians.filter(t => t.name.toLowerCase().includes(norm));
  if (partial.length === 1) {
    // If only one partial match, treat as ambiguous unless identical
    return { resolved: null, ambiguous: true, candidateNames: [partial[0]!.name] };
  }
  if (partial.length > 1) {
    return { resolved: null, ambiguous: true, candidateNames: partial.map(t => t.name) };
  }

  return { resolved: null, ambiguous: false, candidateNames: [] };
}

export type InterpretedDateRange = {
  startDate: string | null;
  endDate: string | null;
  startUtc: string | null;
  endUtc: string | null;
  intervalLabel: string;
};

export function resolveDateInterval(
  periodType: 'today' | 'this_week' | 'last_week' | 'this_month' | 'explicit' | 'all_time',
  capturedNow: Date,
  explicitStart?: string | null,
  explicitEnd?: string | null
): InterpretedDateRange {
  if (periodType === 'all_time' || (!periodType && !explicitStart)) {
    return {
      startDate: null,
      endDate: null,
      startUtc: null,
      endUtc: null,
      intervalLabel: 'All recorded history'
    };
  }

  if (['today', 'this_week', 'last_week', 'this_month'].includes(periodType)) {
    const res = resolveMytPeriod(periodType as 'today' | 'this_week' | 'last_week' | 'this_month', capturedNow);
    return {
      startDate: res.startDate,
      endDate: res.endDate,
      startUtc: res.startUtc.toISOString(),
      endUtc: res.endUtc.toISOString(),
      intervalLabel: res.label
    };
  }

  if (periodType === 'explicit' && explicitStart && explicitEnd) {
    if (isValidMytDateString(explicitStart) && isValidMytDateString(explicitEnd) && explicitStart <= explicitEnd) {
      const startUtc = mytDateToStartUtc(explicitStart);
      const endUtc = mytDateToEndUtcExclusive(explicitEnd);
      const label = explicitStart === explicitEnd ? `${explicitStart} (MYT)` : `${explicitStart} to ${explicitEnd} (MYT)`;
      return {
        startDate: explicitStart,
        endDate: explicitEnd,
        startUtc: startUtc.toISOString(),
        endUtc: endUtc.toISOString(),
        intervalLabel: label
      };
    }
  }

  // Default fallback to all recorded history
  return {
    startDate: null,
    endDate: null,
    startUtc: null,
    endUtc: null,
    intervalLabel: 'All recorded history'
  };
}

export function compileResolvedFilters(
  plan: QueryPlan,
  technicians: TechnicianRef[],
  capturedNow: Date
): ResolvedFilters {
  const { filters } = plan;
  let technician: { id: string; name: string } | null = null;
  if (filters.technicianId) {
    const found = technicians.find(t => t.id === filters.technicianId);
    if (found) {
      technician = { id: found.id, name: found.name };
    }
  }

  let intervalRange: InterpretedDateRange;
  if (filters.startDate && filters.endDate) {
    intervalRange = resolveDateInterval('explicit', capturedNow, filters.startDate, filters.endDate);
  } else {
    intervalRange = resolveDateInterval('all_time', capturedNow);
  }

  return {
    technician,
    serviceType: filters.serviceType,
    dateBasis: filters.dateBasis,
    intervalLabel: intervalRange.intervalLabel,
    startDate: intervalRange.startDate,
    endDate: intervalRange.endDate,
    startUtc: intervalRange.startUtc,
    endUtc: intervalRange.endUtc,
    customerName: filters.customerName,
    serviceText: filters.serviceText
  };
}

export function buildSystemPrompt(technicians: TechnicianRef[], currentMytDay: string): string {
  const techList = technicians.map(t => `${t.name} (${t.id})`).join(', ');
  return `You are the AI Operations Assistant for Sejuk Sejuk Service, an air conditioning operations portal.
Current date in Malaysia Time (MYT, UTC+8) is ${currentMytDay}.
Available seed technicians: ${techList}.

Your job is to interpret user operations questions and map them to one of 5 supported operations:
1. findOrders: find matching orders (up to 25 newest rows plus total count)
2. countOrders: count exact matching orders
3. rankTechnicians: rank technicians by orderCount or quotedValue
4. totalQuotedValue: sum total quoted MYR value across all matching orders
5. lookupOrder: exact lookup of a single order by canonical order number (SO-000001)

Filters supported:
- technicianId (UUID from available technicians list)
- serviceType: "installation" | "servicing" | "repair" | null
- dateBasis: "createdAt" (default) or "assignedAt" (when user explicitly asks about assignment time)
- startDate and endDate: explicit MYT YYYY-MM-DD strings, or relative period ("today", "this_week", "last_week", "this_month", or null for all time)
- customerName: substring search term (2-200 chars)
- serviceText: problem description or notes substring search term (2-200 chars)

Rules:
- One question maps to ONE operation only. If user asks multiple operations in one question, return clarification.
- "Busiest" or "top" technician requires choosing rankingMetric: "orderCount" or "quotedValue".
- Order number format: SO- followed by 6+ digits (e.g. SO-000001).
- Out-of-scope / Unsupported topics:
  Completion tracking, completed jobs, collected payments, revenue, unpaid balances, appointment scheduling, live technician availability, workload predictions, future work.
  When user asks about unsupported topics, return { "kind": "unsupported", "message": "...", "suggestions": [...] }.
  Never answer completion questions with 0 or substitute assignment. Quoted price is NOT revenue.
- If technician name is ambiguous or unknown, return { "kind": "clarification", "message": "...", "choices": [...] }.
- Output must be strict JSON without code fences or Markdown formatting.

Output Schema:
{
  "kind": "query",
  "plan": {
    "operation": "findOrders" | "countOrders" | "rankTechnicians" | "totalQuotedValue" | "lookupOrder",
    "filters": {
      "technicianId": string | null,
      "serviceType": "installation" | "servicing" | "repair" | null,
      "dateBasis": "createdAt" | "assignedAt",
      "startDate": "YYYY-MM-DD" | null,
      "endDate": "YYYY-MM-DD" | null,
      "periodType": "today" | "this_week" | "last_week" | "this_month" | "explicit" | "all_time",
      "customerName": string | null,
      "serviceText": string | null
    },
    "orderNumber": string | null,
    "rankingMetric": "orderCount" | "quotedValue" | null
  }
}
OR
{
  "kind": "clarification",
  "message": string,
  "choices": [ { "label": string, "question": string } ]
}
OR
{
  "kind": "unsupported",
  "message": string,
  "suggestions": [ { "label": string, "question": string } ]
}`;
}

