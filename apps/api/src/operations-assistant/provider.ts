import {
  type AssistantEvidence,
  type ClarificationResponse,
  type ProviderOrderRow,
  type ProviderRankingRow,
  type ProviderRetrievalDto,
  type QueryPlan,
  type RecentExchange,
  type ResolvedFilters,
  type SummarySource,
  type UnsupportedResponse,
  getMytDateParts,
  validateQueryPlan
} from '../../../../packages/contracts/src/operations-assistant.js';
import { type TechnicianRef, buildSystemPrompt } from './plans.js';
import { AppError } from '../errors.js';

export type ProviderConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

export type InterpretationOutcome =
  | { kind: 'query'; plan: QueryPlan }
  | ClarificationResponse
  | UnsupportedResponse;

export type SummaryOutcome = {
  narrative: string;
  source: SummarySource;
};

export interface AiProvider {
  interpretQuestion(
    question: string,
    recentExchanges: RecentExchange[],
    previousQuery: QueryPlan | null,
    technicians: TechnicianRef[],
    capturedNow: Date,
    signal?: AbortSignal
  ): Promise<InterpretationOutcome>;

  generateSummary(
    dto: ProviderRetrievalDto,
    question: string,
    recentExchanges: RecentExchange[],
    signal?: AbortSignal
  ): Promise<SummaryOutcome>;
}

// Deterministic summary fallback when AI is disabled, times out, or fails grounding
export function generateDeterministicSummary(
  evidence: AssistantEvidence,
  resolved: ResolvedFilters
): string {
  const timeDesc = resolved.intervalLabel;
  const filterParts: string[] = [];
  if (resolved.technician) filterParts.push(`assigned to ${resolved.technician.name}`);
  if (resolved.serviceType) filterParts.push(`for ${resolved.serviceType} service`);
  if (resolved.customerName) filterParts.push(`matching customer "${resolved.customerName}"`);
  if (resolved.serviceText) filterParts.push(`matching text "${resolved.serviceText}"`);
  const filterDesc = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

  switch (evidence.kind) {
    case 'countOrders':
      return `Found ${evidence.data.matchingCount} service order${evidence.data.matchingCount === '1' ? '' : 's'} for ${timeDesc}${filterDesc}.`;

    case 'totalQuotedValue':
      return `Total quoted value for ${timeDesc}${filterDesc} is MYR ${evidence.data.totalQuotedValue} across ${evidence.data.matchingCount} order${evidence.data.matchingCount === '1' ? '' : 's'}. Quoted value reflects estimated quotes and does not represent collected revenue.`;

    case 'findOrders': {
      const { matchingCount, returnedCount, truncated } = evidence.data;
      if (matchingCount === '0') {
        return `No service orders found for ${timeDesc}${filterDesc}.`;
      }
      const countNote = truncated
        ? `Showing the 25 most recent orders out of ${matchingCount} matching orders`
        : `Showing all ${returnedCount} matching order${returnedCount === 1 ? '' : 's'}`;
      return `${countNote} for ${timeDesc}${filterDesc}.`;
    }

    case 'rankTechnicians': {
      const { items, metric } = evidence.data;
      if (items.length === 0) {
        return `No technician ranking available for ${timeDesc}${filterDesc} as no matching orders were found.`;
      }
      const metricLabel = metric === 'orderCount' ? 'order count' : 'total quoted value';
      const topTech = items[0]!;
      const valStr = metric === 'orderCount' ? `${topTech.orderCount} orders` : `MYR ${topTech.totalQuotedValue}`;
      return `Technician ranking by ${metricLabel} for ${timeDesc}${filterDesc}: ${topTech.technician.name} is ranked #1 with ${valStr}. Assignment ranking reflects assigned workload and does not imply completion or quality.`;
    }

    case 'lookupOrder': {
      const { order } = evidence.data;
      if (!order) {
        return 'No order was found matching the requested order number in recorded history.';
      }
      return `Order ${order.orderNumber} is assigned to ${order.technician.name} for ${order.serviceType} service with quoted price MYR ${order.quotedPrice.amount}.`;
    }
  }
}

// Extract and sanitize JSON string from AI model responses, removing code fences and thinking tags
export function extractJsonText(raw: string): string {
  // Strip any reasoning / thinking tags if present (e.g. <think>...</think>)
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  } else {
    // If no complete code fence is found, locate the outermost JSON object braces
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  return text;
}

// Convert authoritative evidence into minimal privacy-safe provider DTO
export function buildProviderRetrievalDto(
  plan: QueryPlan,
  resolved: ResolvedFilters,
  evidence: AssistantEvidence
): ProviderRetrievalDto {
  const baseFilters = {
    technicianName: resolved.technician ? resolved.technician.name : null,
    serviceType: resolved.serviceType,
    dateBasis: resolved.dateBasis,
    mytInterval: resolved.intervalLabel,
    customerNameSearch: resolved.customerName,
    serviceTextSearch: resolved.serviceText
  };

  switch (evidence.kind) {
    case 'findOrders': {
      const orderRows: ProviderOrderRow[] = evidence.data.items.map(item => ({
        orderNumber: item.orderNumber,
        serviceType: item.serviceType,
        technicianName: item.technician.name,
        quote: `MYR ${item.quotedPrice.amount}`,
        createdAtMyt: item.createdAt,
        assignedAtMyt: item.assignedAt
      }));
      return {
        operation: 'findOrders',
        filters: baseFilters,
        matchingCount: evidence.data.matchingCount,
        orderRows
      };
    }

    case 'countOrders':
      return {
        operation: 'countOrders',
        filters: baseFilters,
        matchingCount: evidence.data.matchingCount
      };

    case 'totalQuotedValue':
      return {
        operation: 'totalQuotedValue',
        filters: baseFilters,
        matchingCount: evidence.data.matchingCount,
        totalQuotedValue: `MYR ${evidence.data.totalQuotedValue}`
      };

    case 'rankTechnicians': {
      const rankings: ProviderRankingRow[] = evidence.data.items.map(item => ({
        technicianName: item.technician.name,
        rank: item.rank,
        orderCount: item.orderCount,
        totalQuotedValue: `MYR ${item.totalQuotedValue}`
      }));
      return {
        operation: 'rankTechnicians',
        filters: baseFilters,
        matchingCount: evidence.data.items.length.toString(),
        rankingMetric: evidence.data.metric,
        rankings
      };
    }

    case 'lookupOrder': {
      const { order } = evidence.data;
      const orderLookup = order
        ? {
            found: true,
            orderNumber: order.orderNumber,
            serviceType: order.serviceType,
            technicianName: order.technician.name,
            quote: `MYR ${order.quotedPrice.amount}`,
            createdAtMyt: order.createdAt,
            assignedAtMyt: order.assignedAt
          }
        : { found: false };
      return {
        operation: 'lookupOrder',
        filters: baseFilters,
        matchingCount: order ? '1' : '0',
        orderLookup
      };
    }
  }
}

// Real OpenAI-compatible Chat Completions Provider
export class OpenAiChatCompletionsProvider implements AiProvider {
  constructor(private config: ProviderConfig) {}

  async interpretQuestion(
    question: string,
    recentExchanges: RecentExchange[],
    previousQuery: QueryPlan | null,
    technicians: TechnicianRef[],
    capturedNow: Date,
    signal?: AbortSignal
  ): Promise<InterpretationOutcome> {
    if (!this.config.enabled || !this.config.baseUrl || !this.config.apiKey || !this.config.model) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'AI assistant is not configured on this server.');
    }

    const currentMytDay = capturedNow.toISOString().split('T')[0]!;
    const systemPrompt = buildSystemPrompt(technicians, currentMytDay);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];

    if (previousQuery) {
      messages.push({
        role: 'system',
        content: `Previous validated query state: ${JSON.stringify(previousQuery)}`
      });
    }

    for (const ex of recentExchanges.slice(-6)) {
      messages.push({ role: 'user', content: ex.question });
      messages.push({ role: 'assistant', content: ex.narrative });
    }

    messages.push({ role: 'user', content: question });

    const endpoint = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const abortHandler = () => controller.abort();
    signal?.addEventListener('abort', abortHandler);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0,
          max_tokens: 1000
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'AI provider returned an error.');
      }

      const body: any = await res.json();
      const choice = body?.choices?.[0];
      if (choice?.finish_reason && choice.finish_reason !== 'stop') {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'AI model output was truncated.');
      }

      const content = choice?.message?.content?.trim();
      if (!content) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'AI provider returned an empty response.');
      }

      const jsonText = extractJsonText(content);
      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'AI provider returned invalid JSON.');
      }

      if (parsed.kind === 'clarification') {
        return {
          kind: 'clarification',
          message: String(parsed.message || 'Please clarify your request.'),
          choices: Array.isArray(parsed.choices) ? parsed.choices : undefined
        };
      }

      if (parsed.kind === 'unsupported') {
        return {
          kind: 'unsupported',
          message: String(parsed.message || 'This operational query is not supported.'),
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : undefined
        };
      }

      if (parsed.kind === 'query' && parsed.plan) {
        const validated = validateQueryPlan(parsed.plan);
        if (!validated.valid) {
          throw new AppError(503, 'SERVICE_UNAVAILABLE', `AI query plan validation failed: ${validated.error}`);
        }
        return { kind: 'query', plan: validated.plan };
      }

      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unrecognized AI interpretation response format.');
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (controller.signal.aborted || signal?.aborted) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'AI interpretation request timed out or was cancelled.');
      }
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Failed to communicate with AI provider.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
    }
  }

  async generateSummary(
    dto: ProviderRetrievalDto,
    question: string,
    recentExchanges: RecentExchange[],
    signal?: AbortSignal
  ): Promise<SummaryOutcome> {
    if (!this.config.enabled || !this.config.baseUrl || !this.config.apiKey || !this.config.model) {
      return { narrative: '', source: 'deterministic' };
    }

    const systemPrompt = `You are an AI Operations Assistant summarizing operational aircon service orders.
Summarize the factual results provided in the JSON data accurately and concisely.
Rules:
- Never quote personal information, customer names, phone numbers, addresses, or admin notes.
- Do not invent numbers, orders, or completion statuses. Quoted value is NOT revenue.
- Assignment does not imply completion.
- Distinguish quotes from revenue clearly.
- Keep the summary short (2-3 sentences max).`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
      { role: 'user', content: `Retrieved Facts JSON: ${JSON.stringify(dto)}` }
    ];

    const endpoint = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const abortHandler = () => controller.abort();
    signal?.addEventListener('abort', abortHandler);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0,
          max_tokens: 1000
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        return { narrative: '', source: 'deterministic' };
      }

      const body: any = await res.json();
      const rawNarrative = body?.choices?.[0]?.message?.content?.trim();
      if (!rawNarrative) {
        return { narrative: '', source: 'deterministic' };
      }

      // Strip reasoning/thinking tags if present
      const narrative = rawNarrative.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (!narrative) {
        return { narrative: '', source: 'deterministic' };
      }

      // Grounding validation: verify matching count is not contradicted
      if (dto.matchingCount && !narrative.includes(dto.matchingCount) && dto.matchingCount !== '0') {
        // If free narrative misses basic grounding, prefer deterministic fallback
        return { narrative: '', source: 'deterministic' };
      }

      return { narrative, source: 'ai' };
    } catch {
      return { narrative: '', source: 'deterministic' };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
    }
  }
}

// Deterministic Fake Provider for Automated Testing
export class DeterministicFakeProvider implements AiProvider {
  async interpretQuestion(
    question: string,
    _recentExchanges: RecentExchange[],
    previousQuery: QueryPlan | null,
    technicians: TechnicianRef[],
    capturedNow: Date,
    _signal?: AbortSignal
  ): Promise<InterpretationOutcome> {
    const qLower = question.toLowerCase();

    // 1. Unsupported check
    if (
      qLower.includes('completed') ||
      qLower.includes('revenue') ||
      qLower.includes('schedule') ||
      qLower.includes('unpaid') ||
      qLower.includes('future')
    ) {
      return {
        kind: 'unsupported',
        message: 'Completion tracking, revenue collection, and appointment scheduling are not tracked in service orders.',
        suggestions: [
          { label: 'View active orders', question: 'How many service orders are currently assigned?' },
          { label: 'Check quoted prices', question: 'What is the total quoted value of all orders?' }
        ]
      };
    }

    // 2. Ambiguity check: if user mentions an unknown or ambiguous tech
    if (qLower.includes('ahmad') || qLower.includes('unknown tech')) {
      return {
        kind: 'clarification',
        message: 'Could not find a technician matching that name. Did you mean one of the seed technicians?',
        choices: [
          { label: 'Ali', question: 'Show orders for Ali' },
          { label: 'Bala', question: 'Show orders for Bala' }
        ]
      };
    }

    // 3. Technician resolution
    let resolvedTechId: string | null = null;
    for (const tech of technicians) {
      if (qLower.includes(tech.name.toLowerCase())) {
        resolvedTechId = tech.id;
        break;
      }
    }

    // 4. Service type resolution
    let resolvedServiceType: 'installation' | 'servicing' | 'repair' | null = null;
    if (qLower.includes('installation')) resolvedServiceType = 'installation';
    else if (qLower.includes('servicing')) resolvedServiceType = 'servicing';
    else if (qLower.includes('repair')) resolvedServiceType = 'repair';

    // 5. Date interval
    let startDate: string | null = null;
    let endDate: string | null = null;
    const myt = getMytDateParts(capturedNow);

    if (qLower.includes('today')) {
      startDate = myt.mytDay;
      endDate = myt.mytDay;
    } else if (qLower.includes('this week')) {
      const d = new Date(Date.UTC(myt.year, myt.month - 1, myt.day));
      const day = (d.getUTCDay() + 6) % 7;
      const mon = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - day));
      startDate = `${mon.getUTCFullYear()}-${(mon.getUTCMonth() + 1).toString().padStart(2, '0')}-${mon.getUTCDate().toString().padStart(2, '0')}`;
      endDate = myt.mytDay;
    } else if (qLower.includes('this month')) {
      startDate = `${myt.year}-${myt.month.toString().padStart(2, '0')}-01`;
      endDate = myt.mytDay;
    }

    // Follow-up carryover: if previousQuery exists, carry forward filters
    if (previousQuery) {
      if (!resolvedTechId && previousQuery.filters.technicianId && !qLower.includes('all technician')) {
        resolvedTechId = previousQuery.filters.technicianId;
      }
      if (!resolvedServiceType && previousQuery.filters.serviceType && !qLower.includes('all service')) {
        resolvedServiceType = previousQuery.filters.serviceType;
      }
      if (!startDate && previousQuery.filters.startDate) {
        startDate = previousQuery.filters.startDate;
        endDate = previousQuery.filters.endDate;
      }
    }

    // 6. Operation resolution
    const soMatch = /SO-\d{6,}/i.exec(question);
    if (soMatch) {
      return {
        kind: 'query',
        plan: {
          operation: 'lookupOrder',
          filters: {
            technicianId: null,
            serviceType: null,
            dateBasis: 'createdAt',
            startDate: null,
            endDate: null,
            customerName: null,
            serviceText: null
          },
          orderNumber: soMatch[0].toUpperCase(),
          rankingMetric: null
        }
      };
    }

    if (qLower.includes('who is the busiest') || qLower.includes('rank') || qLower.includes('top tech')) {
      const metric = qLower.includes('quote') || qLower.includes('value') ? 'quotedValue' : 'orderCount';
      return {
        kind: 'query',
        plan: {
          operation: 'rankTechnicians',
          filters: {
            technicianId: resolvedTechId,
            serviceType: resolvedServiceType,
            dateBasis: 'createdAt',
            startDate,
            endDate,
            customerName: null,
            serviceText: null
          },
          orderNumber: null,
          rankingMetric: metric
        }
      };
    }

    if (qLower.includes('total quoted') || qLower.includes('total value') || qLower.includes('sum')) {
      return {
        kind: 'query',
        plan: {
          operation: 'totalQuotedValue',
          filters: {
            technicianId: resolvedTechId,
            serviceType: resolvedServiceType,
            dateBasis: 'createdAt',
            startDate,
            endDate,
            customerName: null,
            serviceText: null
          },
          orderNumber: null,
          rankingMetric: null
        }
      };
    }

    if (qLower.includes('how many') || qLower.includes('count')) {
      return {
        kind: 'query',
        plan: {
          operation: 'countOrders',
          filters: {
            technicianId: resolvedTechId,
            serviceType: resolvedServiceType,
            dateBasis: 'createdAt',
            startDate,
            endDate,
            customerName: null,
            serviceText: null
          },
          orderNumber: null,
          rankingMetric: null
        }
      };
    }

    // Default to findOrders
    let searchCustomer: string | null = null;
    let searchText: string | null = null;
    if (qLower.includes('customer')) {
      searchCustomer = 'Synthetic Customer';
    }
    if (qLower.includes('leaking')) {
      searchText = 'leaking';
    } else if (qLower.includes('cooling')) {
      searchText = 'cooling';
    }

    return {
      kind: 'query',
      plan: {
        operation: 'findOrders',
        filters: {
          technicianId: resolvedTechId,
          serviceType: resolvedServiceType,
          dateBasis: 'createdAt',
          startDate,
          endDate,
          customerName: searchCustomer,
          serviceText: searchText
        },
        orderNumber: null,
        rankingMetric: null
      }
    };
  }

  async generateSummary(
    dto: ProviderRetrievalDto,
    _question: string,
    _recentExchanges: RecentExchange[],
    _signal?: AbortSignal
  ): Promise<SummaryOutcome> {
    // Generate grounded deterministic summary
    let narrative = '';
    if (dto.operation === 'countOrders') {
      narrative = `There are ${dto.matchingCount} orders matching your criteria.`;
    } else if (dto.operation === 'totalQuotedValue') {
      narrative = `The total quoted price is ${dto.totalQuotedValue} across ${dto.matchingCount} matching orders.`;
    } else if (dto.operation === 'rankTechnicians') {
      const top = dto.rankings?.[0];
      narrative = top
        ? `${top.technicianName} is ranked #1 with ${top.orderCount} orders.`
        : 'No technician orders found.';
    } else if (dto.operation === 'lookupOrder') {
      narrative = dto.orderLookup?.found
        ? `Found order ${dto.orderLookup.orderNumber} assigned to ${dto.orderLookup.technicianName}.`
        : 'No order was found matching that order number.';
    } else {
      narrative = `Found ${dto.matchingCount} service orders.`;
    }
    return { narrative, source: 'ai' };
  }
}
