import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth, subscribeAuthLifecycle } from '../auth/index.js';
import { ApiError } from '../api/client.js';
import { queryOperationsAssistant } from '../api/operations-assistant.js';
import type {
  AssistantQueryRequest,
  AssistantResponse,
  QueryPlan,
  RecentExchange
} from '../../../../packages/contracts/src/operations-assistant.js';

export type Exchange = {
  id: string;
  question: string;
  response: AssistantResponse;
};

export type ConversationPhase =
  | 'idle'
  | 'loading'
  | 'error'
  | 'limit_reached';

// Tab-level memory to survive client-side route navigation while remaining memory-only
let retainedExchanges: Exchange[] = [];
let retainedComposer = '';
let retainedPreviousQuery: QueryPlan | null = null;
let retainedAccountId: string | null = null;
let retainedRole: string | null = null;

export function clearTabConversationMemory(keepComposer = false): void {
  retainedExchanges = [];
  retainedPreviousQuery = null;
  if (!keepComposer) {
    retainedComposer = '';
  }
}

export function useConversation() {
  const auth = useAuth();
  const [exchanges, setExchanges] = useState<Exchange[]>(retainedExchanges);
  const [composer, setComposer] = useState<string>(retainedComposer);
  const [previousQuery, setPreviousQuery] = useState<QueryPlan | null>(retainedPreviousQuery);
  const [phase, setPhase] = useState<ConversationPhase>(exchanges.length >= 20 ? 'limit_reached' : 'idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestSeq = useRef<number>(0);
  const authGenerationRef = useRef<number>(auth.authGeneration);
  authGenerationRef.current = auth.authGeneration;

  // Sync memory when local state changes
  useEffect(() => {
    retainedExchanges = exchanges;
    retainedComposer = composer;
    retainedPreviousQuery = previousQuery;
  }, [exchanges, composer, previousQuery]);

  // Account and role validation
  useEffect(() => {
    const currentId = auth.user?.id ?? null;
    const currentRole = auth.user?.role ?? null;

    if (retainedAccountId && (retainedAccountId !== currentId || retainedRole !== currentRole)) {
      clearTabConversationMemory(false);
      setExchanges([]);
      setComposer('');
      setPreviousQuery(null);
      setPhase('idle');
      setErrorMessage(null);
    }

    retainedAccountId = currentId;
    retainedRole = currentRole;
  }, [auth.user?.id, auth.user?.role]);

  // Auth lifecycle subscription: destroy vs suspend
  useEffect(() => {
    return subscribeAuthLifecycle(event => {
      abortControllerRef.current?.abort();

      if (event.type === 'destroy') {
        clearTabConversationMemory(false);
        setExchanges([]);
        setComposer('');
        setPreviousQuery(null);
        setPhase('idle');
        setErrorMessage(null);
      } else if (event.type === 'suspend' && event.reason === 'unauthenticated') {
        // Confirmed 401 unauthenticated clears results and query state, keeps unsent composer
        clearTabConversationMemory(true);
        setExchanges([]);
        setPreviousQuery(null);
        setPhase('idle');
      }
    });
  }, []);

  // Cleanup pending work on unmount / navigation
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setPhase(exchanges.length >= 20 ? 'limit_reached' : 'idle');
    }
  }, [exchanges.length]);

  const startNewConversation = useCallback(() => {
    cancel();
    clearTabConversationMemory(false);
    setExchanges([]);
    setComposer('');
    setPreviousQuery(null);
    setPhase('idle');
    setErrorMessage(null);
    setRetryAfterSeconds(null);
  }, [cancel]);

  const sendQuestion = useCallback(
    async (textToSend?: string) => {
      const q = (textToSend ?? composer).trim();
      if (!q) return;
      if (q.length > 2000) {
        setErrorMessage('Question exceeds maximum limit of 2000 characters.');
        return;
      }

      if (exchanges.length >= 20) {
        setPhase('limit_reached');
        return;
      }

      cancel();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const thisSeq = ++activeRequestSeq.current;
      const capturedAuthGen = authGenerationRef.current;

      setPhase('loading');
      setErrorMessage(null);
      setRetryAfterSeconds(null);

      // Build context from at most 6 recent exchanges
      const recentExchanges: RecentExchange[] = exchanges.slice(-6).map(ex => {
        let narrative = '';
        if (ex.response.kind === 'answer') {
          narrative = ex.response.narrative;
        } else if (ex.response.kind === 'clarification' || ex.response.kind === 'unsupported') {
          narrative = ex.response.message;
        }
        return {
          question: ex.question,
          narrative
        };
      });

      const req: AssistantQueryRequest = {
        question: q,
        recentExchanges,
        previousQuery
      };

      try {
        const response = await queryOperationsAssistant(req, controller.signal);

        // Guard against late callback or invalidated auth generation
        if (
          controller.signal.aborted ||
          thisSeq !== activeRequestSeq.current ||
          capturedAuthGen !== authGenerationRef.current
        ) {
          return;
        }

        const newExchange: Exchange = {
          id: `ex_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          question: q,
          response
        };

        const nextExchanges = [...exchanges, newExchange];
        setExchanges(nextExchanges);

        // Update follow-up query plan state
        if (response.kind === 'answer') {
          setPreviousQuery(response.query);
        }

        // Successfully completed exchange clears unsent composer
        if (!textToSend) {
          setComposer('');
        }

        setPhase(nextExchanges.length >= 20 ? 'limit_reached' : 'idle');
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          thisSeq !== activeRequestSeq.current ||
          capturedAuthGen !== authGenerationRef.current
        ) {
          return;
        }

        if (err instanceof ApiError) {
          if (auth.handleAuthError(err, auth.binding)) {
            return;
          }
          if (err.status === 429) {
            setRetryAfterSeconds(err.retryAfterSeconds ?? 5);
            setErrorMessage(err.message || 'Question quota limit reached. Try again later.');
          } else if (err.status === 503) {
            setRetryAfterSeconds(err.retryAfterSeconds ?? 5);
            setErrorMessage(err.message || 'AI assistant is temporarily unavailable. Try again shortly.');
          } else {
            setErrorMessage(err.message || 'Failed to process operations query.');
          }
        } else {
          setErrorMessage('Network or server connection error. Check your connection.');
        }

        setPhase('error');
      } finally {
        if (thisSeq === activeRequestSeq.current) {
          abortControllerRef.current = null;
        }
      }
    },
    [composer, exchanges, previousQuery, cancel, auth]
  );

  return {
    exchanges,
    composer,
    setComposer,
    phase,
    errorMessage,
    retryAfterSeconds,
    sendQuestion,
    cancel,
    startNewConversation,
    canSend: phase === 'idle' && composer.trim().length > 0 && composer.length <= 2000,
    isLimitReached: phase === 'limit_reached' || exchanges.length >= 20
  };
}
