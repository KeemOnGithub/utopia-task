import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createBrowserRouter, RouterProvider, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, subscribeAuthLifecycle } from './auth';
import { AuthGate } from './auth/ProtectedRoute';
import { safeReturnPath } from './auth/safe-return';
import { GuardedLink, NavigationBridge, guardedNavigate } from './navigation';
import { OrdersPage } from './pages/OrdersPage';
import { DraftsPage } from './pages/DraftsPage';
import { CreateOrderPage } from './pages/CreateOrderPage';
import { OrderDetailPage } from './pages/OrderDetailPage';

const SEED_TECHNICIANS = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Ali' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'John' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Bala' },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Yusoff' }
];

function Application() {
  const auth = useAuth();
  const location = useLocation();
  const [mounted, setMounted] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('sejuk_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const desired = useRef(safeReturnPath(location.pathname + location.search));
  const focusedRoute = useRef<string | null>(null);
  const retainedLocation = useRef(location);
  const knownRoute = /^\/(?:orders(?:\/[^/]+)?|drafts(?:\/[^/]+\/edit)?|login|access-denied)?$/.test(location.pathname);
  const visible = auth.phase === 'authenticated';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('sejuk_theme', theme);
    } catch {
      // storage quota or sandboxed
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  if (visible && !['/login', '/access-denied'].includes(location.pathname)) retainedLocation.current = location;

  useEffect(
    () =>
      subscribeAuthLifecycle(event => {
        if (event.type === 'destroy') {
          focusedRoute.current = null;
          setMounted(false);
          setEpoch(value => value + 1);
        } else if (event.type === 'suspend' && event.reason === 'unauthenticated') focusedRoute.current = null;
      }),
    []
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (location.pathname === '/login' || location.pathname === '/') void guardedNavigate(desired.current, { replace: true, bypassGuard: true });
    } else if (auth.phase === 'forbidden' && location.pathname !== '/access-denied') void guardedNavigate('/access-denied', { replace: true, bypassGuard: true });
    else if (auth.phase === 'anonymous' && location.pathname !== '/login' && knownRoute) {
      desired.current = safeReturnPath(location.pathname + location.search);
      void guardedNavigate('/login', { replace: true, bypassGuard: true });
    }
  }, [visible, auth.phase, location.pathname, knownRoute]);

  useLayoutEffect(() => {
    if (!visible || !mounted || ['/', '/login', '/access-denied'].includes(location.pathname)) return;
    const route = location.pathname + location.search;
    if (focusedRoute.current === route) return;
    const heading = document.querySelector<HTMLElement>('[data-protected-content] h1');
    if (heading) {
      focusedRoute.current = route;
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [location.pathname, location.search, visible, mounted]);

  if (!knownRoute) {
    return (
      <>
        <NavigationBridge />
        <main className="surface" style={{ maxWidth: 600, margin: '60px auto' }}>
          <h1 tabIndex={-1}>Page not found</h1>
          <p>This page is not available.</p>
          <GuardedLink to="/orders" className="button primary">Service orders</GuardedLink>
        </main>
      </>
    );
  }

  const denied = location.pathname === '/access-denied' && visible;

  return (
    <>
      <NavigationBridge />
      {!visible && <AuthGate />}
      {denied && (
        <main className="surface" style={{ maxWidth: 600, margin: '60px auto' }}>
          <h1 tabIndex={-1}>Access denied</h1>
          <p>You do not have access to this portal.</p>
          <button className="primary" onClick={() => void auth.logout()}>Sign out</button>
        </main>
      )}
      {mounted && (
        <div key={epoch} hidden={!visible || denied} inert={!visible || denied} data-protected-content>
          <div className="app-shell">
            <aside className="sidebar">
              <div>
                <div className="brand">
                  <div className="brand-icon">❄️</div>
                  <div>
                    <span style={{ display: 'block', fontWeight: 700, color: 'var(--sidebar-text)' }}>Sejuk Sejuk</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>Operations Portal</span>
                  </div>
                </div>
                <nav aria-label="Main navigation">
                  <GuardedLink to="/orders" aria-current={location.pathname.startsWith('/orders') ? 'page' : undefined}>
                    Service orders
                  </GuardedLink>
                  <GuardedLink to="/drafts" aria-current={location.pathname.startsWith('/drafts') ? 'page' : undefined}>
                    My drafts
                  </GuardedLink>
                </nav>

                {/* Live Field Technician Roster */}
                <div className="tech-roster">
                  <div className="tech-roster-title">
                    <span>Field Technicians</span>
                    <span style={{ color: 'var(--primary)' }}>4 Active</span>
                  </div>
                  <div className="tech-roster-list">
                    {SEED_TECHNICIANS.map(tech => (
                      <div key={tech.id} className="tech-roster-item">
                        <span style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="tech-dot available"></span>
                          <span>{tech.name}</span>
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--sidebar-text-muted)' }}>Ready</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sidebar Footer User Pill */}
              <div style={{ paddingTop: 16, borderTop: '1px solid var(--sidebar-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                    <div className="tech-avatar" style={{ width: 28, height: 28, fontSize: 12 }}>AD</div>
                    <div style={{ overflow: 'hidden' }}>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--sidebar-text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        {auth.user?.email}
                      </span>
                      <span style={{ display: 'block', fontSize: 10, color: '#4ade80' }}>
                        ● Admin Session
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            <div className="workspace">
              <header className="utility-bar">
                <span>
                  <span>Admin portal</span>
                  <span style={{ color: 'var(--text-subtle)', margin: '0 4px' }}>/</span>
                  <span style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                    {location.pathname.startsWith('/drafts') ? 'Drafts Management' : 'Order Dispatch'}
                  </span>
                </span>
                
                {/* Theme Toggle Button */}
                <button
                  type="button"
                  className="theme-toggle-btn"
                  title={`Switch to ${theme === 'dark' ? 'Light Frost' : 'Dark Arctic'} mode`}
                  aria-label={`Switch to ${theme === 'dark' ? 'Light Frost' : 'Dark Arctic'} mode`}
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? '☀️' : '🌙'}
                </button>

                <span className="user-badge">
                  <span className="status-dot" style={{ background: '#4ade80' }}></span>
                  <span>{auth.user?.email}</span>
                </span>
                <button onClick={() => void auth.logout()}>Sign out</button>
              </header>

              <main className="page-content">
                <Routes location={visible ? location : retainedLocation.current}>
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/drafts" element={<DraftsPage />} />
                  <Route path="/orders/new" element={<CreateOrderPage />} />
                  <Route path="/drafts/:draftId/edit" element={<CreateOrderPage />} />
                  <Route path="/orders/:orderId" element={<OrderDetailPage />} />
                  <Route
                    path="*"
                    element={
                      <section className="surface page-enter">
                        <h1>Page not found</h1>
                        <p>This page is not available.</p>
                        <GuardedLink to="/orders" className="button primary">Service orders</GuardedLink>
                      </section>
                    }
                  />
                </Routes>
              </main>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const router = createBrowserRouter([{ path: '*', element: <AuthProvider><Application /></AuthProvider> }]);
export function App() {
  return <RouterProvider router={router} />;
}
