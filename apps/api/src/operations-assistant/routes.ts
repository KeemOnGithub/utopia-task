import type { FastifyInstance } from 'fastify';
import { requireOrderReader } from '../auth/index.js';
import { AppError } from '../errors.js';
import {
  type AssistantQueryRequest,
  type AssistantResponse,
  type QueryPlan,
  validateAssistantRequest
} from '../../../../packages/contracts/src/operations-assistant.js';
import { admitQueryRequest, releaseAdmissionLease } from './admission.js';
import { compileResolvedFilters, loadTechniciansReference } from './plans.js';
import { executeAssistantQuery } from './queries.js';
import {
  type AiProvider,
  OpenAiChatCompletionsProvider,
  buildProviderRetrievalDto,
  generateDeterministicSummary
} from './provider.js';

declare module 'fastify' {
  interface FastifyInstance {
    operationsAssistantProvider?: AiProvider;
  }
}

export function registerOperationsAssistantRoutes(app: FastifyInstance): void {
  app.post('/api/operations-assistant/query', { bodyLimit: 131072 }, async (request, reply) => {
    // 1. Authorization before body validation or domain parsing
    const actor = await requireOrderReader(request, reply);
    reply.header('Cache-Control', 'no-store');

    // CSRF check
    const csrfHeader = request.headers['x-csrf-protection'];
    if (csrfHeader !== '1') {
      throw new AppError(403, 'CSRF_REJECTED', 'Missing or invalid X-CSRF-Protection header.');
    }

    // 2. Validate request body shape and limits
    const validation = validateAssistantRequest(request.body);
    if (!validation.valid) {
      throw new AppError(
        validation.code === 'MALFORMED_REQUEST' ? 400 : 422,
        validation.code,
        validation.error
      );
    }
    const queryRequest: AssistantQueryRequest = validation.request;

    // 3. Provider initialization check
    let provider: AiProvider;
    if (app.operationsAssistantProvider) {
      provider = app.operationsAssistantProvider;
    } else if (app.config.aiEnabled && app.config.aiBaseUrl && app.config.aiApiKey && app.config.aiModel) {
      provider = new OpenAiChatCompletionsProvider({
        enabled: true,
        baseUrl: app.config.aiBaseUrl,
        apiKey: app.config.aiApiKey,
        model: app.config.aiModel
      });
    } else {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'AI assistant is not configured on this server.');
    }

    // 4. Capture single server instant for relative dates, MYT day and interpretation
    const capturedNow = new Date();
    const startTime = Date.now();

    // 5. Shared admission & concurrency check
    await admitQueryRequest(app.db, request.id, actor.accountId, capturedNow, {
      dailyLimit: app.config.aiDailyQuestionLimit ?? 500,
      globalConcurrency: app.config.aiGlobalConcurrency ?? 4
    });

    // 45s request timeout controller
    const requestAbortController = new AbortController();
    const deadlineTimer = setTimeout(() => requestAbortController.abort(), 45000);

    const onClientClose = () => requestAbortController.abort();
    request.raw.on('close', onClientClose);

    let plan: QueryPlan | undefined;
    let outcome: 'clarification' | 'unsupported' | 'answer' | 'error' = 'error';

    try {
      // 6. Load technician reference list
      const technicians = await loadTechniciansReference(app.db);

      // 7. Interpret question (call 1 of at most 2)
      const interpretation = await provider.interpretQuestion(
        queryRequest.question,
        queryRequest.recentExchanges,
        queryRequest.previousQuery,
        technicians,
        capturedNow,
        requestAbortController.signal
      );

      if (interpretation.kind === 'clarification') {
        outcome = 'clarification';
        return reply.send({ data: interpretation });
      }

      if (interpretation.kind === 'unsupported') {
        outcome = 'unsupported';
        return reply.send({ data: interpretation });
      }

      plan = interpretation.plan;

      // 8. Compile resolved filters with exact UTC boundaries
      const resolved = compileResolvedFilters(plan, technicians, capturedNow);

      // 9. Database retrieval (5-second statement timeout handled internally)
      const evidence = await executeAssistantQuery(app.db, plan, resolved);
      const retrievedAt = new Date().toISOString();

      // 10. Summary generation (call 2 of at most 2, with deterministic fallback)
      let narrative = '';
      let summarySource: 'ai' | 'deterministic' = 'deterministic';

      const dto = buildProviderRetrievalDto(plan, resolved, evidence);

      try {
        const summaryRes = await provider.generateSummary(
          dto,
          queryRequest.question,
          queryRequest.recentExchanges,
          requestAbortController.signal
        );
        if (summaryRes.narrative && summaryRes.source === 'ai') {
          narrative = summaryRes.narrative;
          summarySource = 'ai';
        } else {
          narrative = generateDeterministicSummary(evidence, resolved);
          summarySource = 'deterministic';
        }
      } catch {
        narrative = generateDeterministicSummary(evidence, resolved);
        summarySource = 'deterministic';
      }

      outcome = 'answer';
      const responseData: AssistantResponse = {
        kind: 'answer',
        operation: plan.operation,
        query: plan,
        resolvedFilters: resolved,
        retrievedAt,
        narrative,
        summarySource,
        evidence
      };

      return reply.send({ data: responseData });
    } finally {
      clearTimeout(deadlineTimer);
      request.raw.off('close', onClientClose);
      // Release lease in finally
      await releaseAdmissionLease(app.db, request.id);

      // Structured logging without PII, URL credentials, prompts or SQL bindings
      console.info(
        JSON.stringify({
          requestId: request.id,
          actorId: actor.accountId,
          operation: plan?.operation,
          outcome,
          durationMs: Date.now() - startTime
        })
      );
    }
  });
}
