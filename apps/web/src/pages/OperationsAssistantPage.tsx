import { useState, useRef, useEffect, type FormEvent } from 'react';
import { GuardedLink } from '../navigation.js';
import { useConversation } from '../operations-assistant/useConversation.js';
import { FormattedText } from '../operations-assistant/FormattedText.js';
import type {
  AssistantResponse,
  OperationalOrder,
  RankingItem,
  ResolvedFilters
} from '../../../../packages/contracts/src/operations-assistant.js';

const SUGGESTED_EXAMPLES = [
  'How many service orders were created this month?',
  'Who is the busiest technician by order count?',
  'What is the total quoted value of repair orders?',
  'Find orders assigned to Ali'
];

function ResolvedFiltersPill({ resolved, retrievedAt }: { resolved: ResolvedFilters; retrievedAt: string }) {
  const parts: string[] = [];
  parts.push(`Period: ${resolved.intervalLabel}`);
  parts.push(`Basis: ${resolved.dateBasis === 'assignedAt' ? 'Assignment time' : 'Creation time'}`);
  if (resolved.technician) parts.push(`Technician: ${resolved.technician.name}`);
  if (resolved.serviceType) parts.push(`Service: ${resolved.serviceType}`);
  if (resolved.customerName) parts.push(`Customer: "${resolved.customerName}"`);
  if (resolved.serviceText) parts.push(`Text: "${resolved.serviceText}"`);

  const formattedTime = new Date(retrievedAt).toLocaleTimeString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        background: 'var(--surface-muted)',
        borderRadius: 8,
        fontSize: 12,
        color: 'var(--text-muted)',
        marginBottom: 12
      }}
    >
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>Interpreted filters:</span>
      {parts.map((p, i) => (
        <span key={i} className="status-pill" style={{ fontSize: 11, padding: '2px 8px' }}>
          {p}
        </span>
      ))}
      <span style={{ marginLeft: 'auto', fontSize: 11 }}>
        Retrieved at {formattedTime} MYT
      </span>
    </div>
  );
}

function EvidenceDisplay({ response }: { response: AssistantResponse }) {
  if (response.kind === 'clarification') {
    return null;
  }
  if (response.kind === 'unsupported') {
    return null;
  }

  const { evidence, resolvedFilters } = response;

  switch (evidence.kind) {
    case 'countOrders':
      return (
        <div className="kpi-card" style={{ maxWidth: 320, margin: '12px 0' }}>
          <span className="kpi-label">Matching Service Orders</span>
          <span className="kpi-value" style={{ fontSize: 32 }}>
            {evidence.data.matchingCount}
          </span>
          <span className="kpi-hint">{resolvedFilters.intervalLabel}</span>
        </div>
      );

    case 'totalQuotedValue':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, margin: '12px 0' }}>
          <div className="kpi-card">
            <span className="kpi-label">Total Quoted Value</span>
            <span className="kpi-value" style={{ fontSize: 28, color: 'var(--primary)' }}>
              MYR {evidence.data.totalQuotedValue}
            </span>
            <span className="kpi-hint">Estimated quoted prices</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Matching Orders</span>
            <span className="kpi-value" style={{ fontSize: 28 }}>
              {evidence.data.matchingCount}
            </span>
            <span className="kpi-hint">{resolvedFilters.intervalLabel}</span>
          </div>
        </div>
      );

    case 'rankTechnicians':
      return (
        <div style={{ margin: '14px 0', overflowX: 'auto' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', overflowWrap: 'anywhere' }}>
            <caption>Field Technician Rankings</caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 70 }}>Rank</th>
                <th scope="col">Technician</th>
                <th scope="col" style={{ textAlign: 'right' }}>Order Count</th>
                <th scope="col" style={{ textAlign: 'right' }}>Total Quoted Value</th>
              </tr>
            </thead>
            <tbody>
              {evidence.data.items.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '16px' }}>
                    No matching technician assignments found.
                  </td>
                </tr>
              ) : (
                evidence.data.items.map((item: RankingItem) => (
                  <tr key={item.technician.id}>
                    <td>
                      <span className="status-pill status-assigned" style={{ fontWeight: 700 }}>
                        #{item.rank}
                      </span>
                    </td>
                    <td>{item.technician.name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.orderCount}</td>
                    <td style={{ textAlign: 'right' }}>MYR {item.totalQuotedValue}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Rankings reflect assigned order counts and quotes; they do not imply completion or technician performance.
          </p>
        </div>
      );

    case 'lookupOrder': {
      const order = evidence.data.order;
      if (!order) {
        return (
          <div style={{ padding: '16px', background: 'var(--surface-muted)', borderRadius: 8, margin: '12px 0' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              No order was found matching the requested order number in recorded history.
            </p>
          </div>
        );
      }
      return (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 18,
            background: 'var(--surface-muted)',
            margin: '12px 0'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <GuardedLink
              to={`/orders/${order.id}`}
              style={{ fontWeight: 700, fontSize: 18, color: 'var(--primary)' }}
            >
              {order.orderNumber}
            </GuardedLink>
            <span className="status-pill status-assigned">
              {order.status}
            </span>
          </div>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <div>
              <dt style={{ fontSize: 11, color: 'var(--text-muted)' }}>Customer</dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{order.customerName}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, color: 'var(--text-muted)' }}>Service Type</dt>
              <dd style={{ margin: 0, textTransform: 'capitalize' }}>{order.serviceType}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, color: 'var(--text-muted)' }}>Assigned Technician</dt>
              <dd style={{ margin: 0 }}>{order.technician.name}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, color: 'var(--text-muted)' }}>Quoted Price</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>MYR {order.quotedPrice.amount}</dd>
            </div>
          </dl>
        </div>
      );
    }

    case 'findOrders': {
      const { items, matchingCount, returnedCount, truncated } = evidence.data;
      if (items.length === 0) {
        return (
          <p style={{ padding: '16px 0', color: 'var(--text-muted)' }}>
            No service orders matched the query filters.
          </p>
        );
      }
      return (
        <div style={{ margin: '14px 0' }}>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Showing {returnedCount} of {matchingCount} matching order{matchingCount === '1' ? '' : 's'}
            {truncated && ' (display capped at 25 newest rows; narrow your search for older orders)'}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', overflowWrap: 'anywhere' }}>
              <caption>Service Order Results</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 110 }}>Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col" style={{ width: 100 }}>Service</th>
                  <th scope="col">Technician</th>
                  <th scope="col" style={{ textAlign: 'right', width: 100 }}>Quote</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order: OperationalOrder) => (
                  <tr key={order.id}>
                    <td>
                      <GuardedLink to={`/orders/${order.id}`} style={{ fontWeight: 600 }}>
                        {order.orderNumber}
                      </GuardedLink>
                    </td>
                    <td>
                      <div>{order.customerName}</div>
                      {order.excerpts?.problemDescription && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          Problem: {order.excerpts.problemDescription}
                        </div>
                      )}
                      {order.excerpts?.adminNotes && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          Note: {order.excerpts.adminNotes}
                        </div>
                      )}
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{order.serviceType}</td>
                    <td>{order.technician.name}</td>
                    <td style={{ textAlign: 'right' }}>MYR {order.quotedPrice.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }
}

export function OperationsAssistantPage() {
  const {
    exchanges,
    composer,
    setComposer,
    phase,
    errorMessage,
    retryAfterSeconds,
    sendQuestion,
    cancel,
    startNewConversation,
    canSend,
    isLimitReached
  } = useConversation();

  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [exchanges.length, phase]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSend) {
      void sendQuestion();
    }
  };

  const handleSuggestionClick = (q: string) => {
    setComposer(q);
    void sendQuestion(q);
  };

  return (
    <div className="page-enter" style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <header className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <p className="eyebrow">Sejuk Sejuk Service Operations</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0 }}>Operations assistant</h1>
            <span className="status-pill status-assigned" style={{ fontSize: 11, padding: '2px 8px' }}>
              Read-Only Operations
            </span>
          </div>
        </div>

        {exchanges.length > 0 && (
          <div className="actions">
            {confirmNewChat ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Clear history?</span>
                <button
                  type="button"
                  className="button primary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => {
                    startNewConversation();
                    setConfirmNewChat(false);
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setConfirmNewChat(false)}
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmNewChat(true)}
              >
                Start new conversation
              </button>
            )}
          </div>
        )}
      </header>

      {/* Persistent Privacy Notice */}
      <aside
        role="note"
        aria-label="Privacy notice"
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 14px',
          background: 'var(--surface-muted)',
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 16
        }}
      >
        <strong style={{ color: 'var(--text)' }}>External AI Notice:</strong> Questions and recent conversation context
        are processed by the configured external AI provider. Please avoid submitting unnecessary personal or sensitive data.
      </aside>

      {/* Supported Examples Banner */}
      {exchanges.length === 0 && (
        <section
          className="surface"
          style={{ marginBottom: 20 }}
          aria-label="Supported operational queries"
        >
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Supported Queries
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px 0' }}>
            Query real persisted orders by date range, technician, service type, or exact order number.
            Quoted prices reflect initial job quotes; collected payments and job completions are not tracked.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTED_EXAMPLES.map((example, i) => (
              <button
                key={i}
                type="button"
                className="button"
                style={{ fontSize: 12, padding: '6px 12px', textAlign: 'left' }}
                onClick={() => handleSuggestionClick(example)}
              >
                &ldquo;{example}&rdquo;
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Conversation Thread */}
      <section aria-label="Conversation exchanges" style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 24 }}>
        {exchanges.map((ex, idx) => (
          <article
            key={ex.id}
            className="surface"
            style={{ borderRadius: 12, padding: 20 }}
            aria-labelledby={`exchange-q-${idx}`}
          >
            {/* User Question */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--primary)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0
                }}
              >
                Q
              </div>
              <div style={{ flex: 1 }}>
                <h3
                  id={`exchange-q-${idx}`}
                  style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}
                >
                  {ex.question}
                </h3>
              </div>
            </div>

            {/* Assistant Response */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              {ex.response.kind === 'answer' && (
                <>
                  <ResolvedFiltersPill
                    resolved={ex.response.resolvedFilters}
                    retrievedAt={ex.response.retrievedAt}
                  />

                  {/* Summary Narrative */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                        {ex.response.summarySource === 'ai' ? 'AI Summary' : 'Authoritative Summary'}
                      </span>
                      <span
                        className="status-pill"
                        style={{ fontSize: 10, padding: '1px 6px' }}
                      >
                        {ex.response.summarySource}
                      </span>
                    </div>
                    <FormattedText
                      text={ex.response.narrative}
                      style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}
                    />
                  </div>

                  {/* Authoritative Structured Evidence */}
                  <EvidenceDisplay response={ex.response} />
                </>
              )}

              {ex.response.kind === 'clarification' && (
                <div style={{ padding: '12px 16px', background: 'var(--surface-muted)', borderRadius: 8 }}>
                  <FormattedText
                    text={ex.response.message}
                    style={{ fontWeight: 600, margin: '0 0 10px 0' }}
                  />
                  {ex.response.choices && ex.response.choices.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {ex.response.choices.map((c, ci) => (
                        <button
                          key={ci}
                          type="button"
                          className="button primary"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => handleSuggestionClick(c.question)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {ex.response.kind === 'unsupported' && (
                <div style={{ padding: '12px 16px', background: 'var(--surface-muted)', borderRadius: 8 }}>
                  <p style={{ fontWeight: 600, color: 'var(--danger)', margin: '0 0 6px 0' }}>
                    Query Not Supported
                  </p>
                  <FormattedText
                    text={ex.response.message}
                    style={{ margin: '0 0 10px 0', fontSize: 13 }}
                  />
                  {ex.response.suggestions && ex.response.suggestions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {ex.response.suggestions.map((s, si) => (
                        <button
                          key={si}
                          type="button"
                          className="button"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => handleSuggestionClick(s.question)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}

        {/* Loading Indicator */}
        {phase === 'loading' && (
          <div
            className="surface"
            style={{ borderRadius: 12, padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="status-dot available" style={{ animation: 'pulse 1s infinite' }}></span>
            <span style={{ fontSize: 14 }}>
              Consulting operations knowledge base and retrieving live order data...
            </span>
            <button
              type="button"
              style={{ marginLeft: 'auto', fontSize: 12 }}
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div role="alert" className="error-panel" style={{ margin: 0 }}>
            <p style={{ margin: 0 }}>{errorMessage}</p>
            {retryAfterSeconds && (
              <p style={{ fontSize: 11, margin: '4px 0 0 0' }}>
                Retry available in {retryAfterSeconds} second{retryAfterSeconds === 1 ? '' : 's'}.
              </p>
            )}
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => void sendQuestion()}
                disabled={phase === 'loading'}
              >
                Retry fresh query
              </button>
            </div>
          </div>
        )}

        {/* Limit Reached Warning */}
        {isLimitReached && (
          <div
            style={{
              padding: 14,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface-muted)',
              textAlign: 'center'
            }}
          >
            <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>
              Conversation exchange limit reached (20 exchanges).
            </p>
            <p style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--text-muted)' }}>
              To ensure context clarity and model efficiency, start a new conversation to ask more questions.
            </p>
            <button
              type="button"
              className="button primary"
              onClick={startNewConversation}
            >
              Start new conversation
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </section>

      {/* Composer Input Box */}
      <section className="surface" style={{ borderRadius: 12, padding: 18 }}>
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="operations-question-input"
            style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}
          >
            Ask a question about service orders
          </label>
          <textarea
            ref={textareaRef}
            id="operations-question-input"
            rows={3}
            value={composer}
            onChange={e => setComposer(e.target.value)}
            disabled={phase === 'loading' || isLimitReached}
            placeholder="e.g. How many repair orders were created this month? What about John?"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 10
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: composer.length > 2000 ? 'var(--danger)' : 'var(--text-muted)'
              }}
            >
              {composer.length} / 2000 characters
            </span>

            <div style={{ display: 'flex', gap: 8 }}>
              {phase === 'loading' && (
                <button type="button" onClick={cancel}>
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="button primary"
                disabled={!canSend}
              >
                Send
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
