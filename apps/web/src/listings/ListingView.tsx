import { useEffect, useState, type ReactNode, type MouseEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { GuardedLink, guardedNavigate } from '../navigation';
import { rememberListReturn } from './navigation';
import { useListing } from './useListing';
import type { Page } from '@sejuk/contracts/listings';

type Props<T extends { id: string }> = {
  kind: 'orders' | 'drafts';
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>;
  columns: string[];
  values: (item: T) => ReactNode[];
  label: (item: T) => string;
  path: (item: T) => string;
};

export function ListingView<T extends { id: string }>({ kind, fetchPage, columns, values, label, path }: Props<T>) {
  const model = useListing(kind, fetchPage), { state } = model;
  const auth = useAuth(), location = useLocation();
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 1100px)').matches);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(min-width: 1100px)'), change = () => setWide(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  function itemLink(item: T) {
    return (
      <GuardedLink
        id={`list-item-${item.id}`}
        className="order-link-pill"
        to={path(item)}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          const key = rememberListReturn(auth.binding, {
            pathname: `/${kind}`,
            cursor: state.cursor,
            originatingItemId: item.id,
            scrollY: window.scrollY
          });
          void guardedNavigate(path(item), { state: key });
        }}
      >
        <span>{label(item)}</span>
      </GuardedLink>
    );
  }

  const title = kind === 'orders' ? 'Service orders' : 'My drafts';
  const count = state.page?.items.length ?? 0;

  return (
    <section className="listing-page page-enter" style={{ minWidth: 0 }}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Sejuk Sejuk Service</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1>{title}</h1>
            <span className="status-pill status-assigned" style={{ fontSize: 11, padding: '2px 8px' }}>
              <span className="status-dot"></span> Live
            </span>
          </div>
        </div>
        <div className="actions">
          {auth.user?.role === 'admin' && (
            <GuardedLink className="button primary" to="/orders/new">
              Create service order
            </GuardedLink>
          )}
          <button type="button" disabled={state.loading} onClick={model.newest}>
            Refresh
          </button>
        </div>
      </header>

      {/* Operational KPI Ribbon when orders are loaded */}
      {kind === 'orders' && state.page && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">Active Orders <span className="status-dot" style={{ background: 'var(--primary)' }}></span></span>
            <span className="kpi-value">{count}</span>
            <span className="kpi-hint">Current page queue</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Field Technicians <span className="status-dot" style={{ background: '#4ade80' }}></span></span>
            <span className="kpi-value">4 Ready</span>
            <span className="kpi-hint">Ali, John, Bala, Yusoff</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Backend Persistence <span>☁️</span></span>
            <span className="kpi-value" style={{ fontSize: 16 }}>Supabase</span>
            <span className="kpi-hint">Secure app_private</span>
          </div>
        </div>
      )}

      {state.message && (
        <p role="status" aria-live="polite" className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          {state.message}
        </p>
      )}

      {state.error && (
        <div role="alert" className="error-panel">
          <p>{state.error}</p>
          {!state.invalid && (
            <button disabled={state.loading || model.retryDisabled} onClick={model.retry}>
              Retry
            </button>
          )}
        </div>
      )}

      <section aria-label={`${title} results`} aria-busy={state.loading} className="surface">
        <h2 ref={model.heading} tabIndex={-1}>Results</h2>
        {state.loading && !state.page && <p>Loading {title.toLowerCase()}...</p>}
        {state.page && (
          <>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Showing {count} {kind}</p>
            {count === 0 ? (
              <p style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                {state.cursor
                  ? `No ${kind} at this list location`
                  : kind === 'orders'
                    ? 'No service orders yet.'
                    : 'No saved drafts yet. Save a draft from the service order form to continue later.'}
              </p>
            ) : wide ? (
              <table style={{ width: '100%', tableLayout: 'fixed', overflowWrap: 'anywhere' }}>
                <caption>{title}</caption>
                <thead>
                  <tr>
                    {columns.map(c => (
                      <th scope="col" key={c}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.page.items.map(item => (
                    <tr key={item.id}>
                      <td>{itemLink(item)}</td>
                      {values(item).map((value, i) => (
                        <td key={columns[i + 1]}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="listing-cards" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
                {state.page.items.map(item => (
                  <li
                    key={item.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: '18px',
                      background: 'var(--surface-muted)',
                      overflowWrap: 'anywhere'
                    }}
                  >
                    <div style={{ marginBottom: 12 }}>
                      {itemLink(item)}
                    </div>
                    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
                      {values(item).map((value, i) => (
                        <div key={columns[i + 1]}>
                          <dt>{columns[i + 1]}</dt>
                          <dd style={{ margin: 0 }}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {(state.invalid || state.cursor !== null || !!count) && (
        <nav aria-label={`${title} pagination`} className="actions" style={{ justifyContent: 'space-between', marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button disabled={state.loading || !model.canPrevious} onClick={model.previous}>
              Previous
            </button>
            <button disabled={state.loading || !state.page?.pagination.hasNextPage || state.blockedNext} onClick={model.next}>
              Next
            </button>
          </div>
          {(state.cursor !== null || state.invalid || location.search) && (
            <button disabled={state.loading} onClick={model.newest}>
              Back to newest
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
