import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { formatMoney, orderStatusLabels, serviceTypeLabels } from '../../../../packages/contracts/src/service-orders.js';
import { useAuth } from '../auth/index.js';
import { GuardedLink } from '../navigation.js';
import { formatTimestamp } from '../listings/format.js';
import { openOrders, resolveListReturn } from '../listings/navigation.js';
import { dismissCreation } from '../order-detail/handoff.js';
import { resolveDetailReturn } from '../order-detail/navigation.js';
import { useOrderDetail } from '../order-detail/useOrderDetail.js';

function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div
      className={full ? 'full-width' : undefined}
      style={{
        minWidth: 0,
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px'
      }}
    >
      <dt style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontWeight: 500, fontSize: 15, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {children}
      </dd>
    </div>
  );
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const location = useLocation();
  const auth = useAuth();
  const { state, visit, focus, visible, retry, refreshVisit } = useOrderDetail(orderId);
  const heading = useRef<HTMLHeadingElement>(null);
  const detail = useRef<HTMLHeadingElement>(null);
  const error = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState(Date.now());
  const retryAt = 'retryAt' in state ? state.retryAt : 0;

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    if (!visible || !focus) return;
    (focus.target === 'detail' ? detail.current : error.current)?.focus();
  }, [focus, visible]);

  useEffect(() => {
    if (visible) document.title = state.kind === 'ready' ? `Service order ${state.order.orderNumber}` : 'Service order';
  }, [state, visible]);

  if (!visible) return null;

  const order = state.kind === 'ready' ? state.order : null;
  const receipt = visit && !visit.dismissed ? visit.receipt : null;
  const banner =
    receipt && !('suppressReceipt' in state && state.suppressReceipt)
      ? state.kind === 'ready'
        ? `Order ${receipt.orderNumber} created successfully.`
        : state.kind === 'loading'
          ? `Order ${receipt.orderNumber} was created. Loading saved order details...`
          : `Order ${receipt.orderNumber} was created, but its details could not be loaded.`
      : null;

  const returnToOrders = () => {
    if (!auth.isCurrent(auth.binding)) return;
    const key = typeof location.state === 'string' ? location.state : null;
    const context = typeof key === 'string' ? resolveListReturn(auth.binding, key) : null;
    openOrders(resolveDetailReturn(visit?.creationIntent ?? false, context));
  };

  return (
    <div className="surface page-enter" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <button type="button" onClick={returnToOrders}>
          Service orders
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="eyebrow">Order Dispatch Record</p>
          <h1 ref={heading} tabIndex={-1} style={{ margin: 0 }}>
            {order ? `Service order ${order.orderNumber}` : state.kind === 'invalidLink' ? 'Invalid order link' : 'Service order'}
          </h1>
        </div>
        {order && (
          <span className="status-pill status-assigned" style={{ fontSize: 13, padding: '6px 14px' }}>
            <span className="status-dot"></span>
            <span>{orderStatusLabels[order.status]}</span>
          </span>
        )}
      </div>

      {banner && (
        <div className="success-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p role="status" style={{ margin: 0, fontWeight: 500 }}>
            ✓ {banner}
          </p>
          <button
            type="button"
            aria-label="Dismiss creation confirmation"
            onClick={() => {
              if (visit) dismissCreation(visit.visitId);
              refreshVisit();
              (order ? detail.current : heading.current)?.focus();
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div aria-label="Saved order details" aria-busy={state.kind === 'loading'}>
        {state.kind === 'loading' && !banner && <p role="status" className="muted">Loading saved order details...</p>}
        {'message' in state && (
          <div className="error-panel" role="alert" tabIndex={-1} ref={error}>
            {state.message}
          </div>
        )}
        {['loadError', 'consistencyError'].includes(state.kind) || (state.kind === 'missing' && visit?.receipt) ? (
          <button type="button" disabled={retryAt > clock} onClick={retry} style={{ marginBottom: 20 }}>
            Retry loading{retryAt > clock ? ` (available in ${Math.ceil((retryAt - clock) / 1000)}s)` : ''}
          </button>
        ) : null}

        {order && (
          <>
            <section aria-labelledby="customer-details">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span>👤</span>
                <h2 id="customer-details" ref={detail} tabIndex={-1} style={{ margin: 0 }}>
                  Customer details
                </h2>
              </div>
              <dl className="detail-grid" style={{ margin: 0 }}>
                <Field label="Customer name">{order.customerName}</Field>
                <Field label="Phone">{order.phone}</Field>
                <Field label="Address" full>
                  {order.address}
                </Field>
              </dl>
            </section>

            <section aria-labelledby="service-details">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span>❄️</span>
                <h2 id="service-details" style={{ margin: 0 }}>
                  Service details
                </h2>
              </div>
              <dl className="detail-grid" style={{ margin: 0 }}>
                <Field label="Service type">{serviceTypeLabels[order.serviceType]}</Field>
                <Field label="Quoted price (MYR)">
                  <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {formatMoney(order.quotedPrice)}
                  </span>
                </Field>
                <Field label="Problem description" full>
                  {order.problemDescription}
                </Field>
              </dl>
            </section>

            <section aria-labelledby="assignment-notes">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span>🛠️</span>
                <h2 id="assignment-notes" style={{ margin: 0 }}>
                  Assignment and notes
                </h2>
              </div>
              <dl className="detail-grid" style={{ margin: 0 }}>
                <Field label="Assigned technician">
                  <span className="tech-badge">
                    <span className="tech-avatar">{order.assignedTechnician.name.charAt(0)}</span>
                    <span>{order.assignedTechnician.name}</span>
                  </span>
                </Field>
                <Field label="Admin notes" full>
                  {order.adminNotes ?? 'No admin notes'}
                </Field>
              </dl>
            </section>

            <section aria-labelledby="traceability">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span>🔍</span>
                <h2 id="traceability" style={{ margin: 0 }}>
                  Traceability
                </h2>
              </div>
              <dl className="detail-grid" style={{ margin: 0 }}>
                <Field label="Created by (account ID)">{order.createdByAccountId}</Field>
                <Field label="Created at">
                  <time dateTime={order.createdAt} className="tabular-nums">
                    {formatTimestamp(order.createdAt)}
                  </time>
                </Field>
                <Field label="Assigned by (account ID)">{order.assignedByAccountId}</Field>
                <Field label="Assigned at">
                  <time dateTime={order.assignedAt} className="tabular-nums">
                    {formatTimestamp(order.assignedAt)}
                  </time>
                </Field>
              </dl>
            </section>

            <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <GuardedLink className="button primary" to="/orders/new">
                Create another order
              </GuardedLink>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
