import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth';

export function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('sejuk_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

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

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const handleFillDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setFields({});
    setError('');
    setTimeout(() => {
      passwordRef.current?.focus();
    }, 0);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || retryAt > Date.now()) return;
    const invalid: Record<string, string[]> = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      invalid.email = ['Enter a valid email address.'];
    }
    if (Array.from(password).length < 8 || Array.from(password).length > 128) {
      invalid.password = ['Use 8-128 Unicode characters.'];
    }
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) {
      (invalid.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setPending(true);
    try {
      await auth.login({ email, password });
      setPassword('');
    } catch (failure) {
      setPassword('');
      setError(failure instanceof ApiError ? failure.message : 'Sign in could not be confirmed. Retry signing in or check your session.');
      if (failure instanceof ApiError) {
        setFields(failure.fieldErrors ?? {});
        if (failure.retryAfterSeconds) setRetryAt(Date.now() + failure.retryAfterSeconds * 1000);
      }
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setPending(false);
    }
  }

  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));

  return (
    <main className="login-page">
      <div className="login-container">
        {/* Top Header with Brand and Theme Switcher */}
        <div className="login-brand-header">
          <div className="brand" style={{ marginBottom: 0 }}>
            <div className="brand-icon">❄️</div>
            <div>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 18, color: 'var(--text-bright)' }}>Sejuk Sejuk Service</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>Operations Portal</span>
            </div>
          </div>
          <button
            type="button"
            className="theme-toggle-btn"
            title={`Switch to ${theme === 'dark' ? 'Light Frost' : 'Dark Arctic'} mode`}
            aria-label={`Switch to ${theme === 'dark' ? 'Light Frost' : 'Dark Arctic'} mode`}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Main Sign In Surface */}
        <section className="surface login-card">
          <div className="login-card-header">
            <p className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>
              Sejuk Sejuk Service / Admin portal
            </p>
            <h1 tabIndex={-1}>Sign in</h1>
            <p style={{ color: 'var(--text-subtle)', fontSize: 13, margin: '6px 0 0', lineHeight: 1.5 }}>
              Sign in with your admin credentials to access service order dispatch and technician assignment.
            </p>
          </div>

          {auth.phase === 'recovering' && (
            <p role="status" style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(234, 179, 8, 0.12)', border: '1px solid rgba(234, 179, 8, 0.3)', color: 'var(--warning)', fontSize: 13, margin: '14px 0 0' }}>
              Your session has expired. Sign in to continue. Unsaved work is retained only for the same account in this tab.
            </p>
          )}

          {error && (
            <div className="error" role="alert" tabIndex={-1} ref={errorRef} style={{ marginTop: 14 }}>
              {error}
            </div>
          )}

          <form onSubmit={submit} noValidate aria-busy={pending} style={{ marginTop: 16 }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>All fields are required.</p>

            <div className="field-group">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                ref={emailRef}
                type="email"
                autoComplete="username"
                required
                placeholder="admin@example.test"
                value={email}
                onChange={e => setEmail(e.target.value)}
                aria-invalid={!!fields.email}
                aria-describedby={fields.email ? 'login-email-error' : undefined}
              />
              {fields.email && <p className="error" id="login-email-error">{fields.email.join(' ')}</p>}
            </div>

            <div className="field-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                aria-invalid={!!fields.password}
                aria-describedby={fields.password ? 'login-password-error' : undefined}
              />
              {fields.password && <p className="error" id="login-password-error">{fields.password.join(' ')}</p>}
            </div>

            <p role="status" style={{ margin: 0, fontSize: 13, color: wait > 0 ? 'var(--warning)' : undefined }}>
              {pending ? 'Signing in...' : wait ? `Try again in ${wait} seconds.` : ''}
            </p>

            <button className="primary" disabled={pending || wait > 0} type="submit" style={{ width: '100%', height: 44, marginTop: 4 }}>
              {pending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {auth.phase === 'recovering' && (
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button type="button" className="secondary" onClick={() => void auth.refreshSession()}>
                Retry session verification
              </button>
            </div>
          )}

          {/* Demo Credentials Helper */}
          <div className="login-assessment-box">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Demo Admin: <code style={{ color: 'var(--text-bright)' }}>admin@example.test</code>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
                  onClick={() => handleFillDemo('admin@example.test', 'admin123456')}
                >
                  Auto-fill Admin
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Demo Manager: <code style={{ color: 'var(--text-bright)' }}>manager@example.test</code>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
                  onClick={() => handleFillDemo('manager@example.test', 'admin123456')}
                >
                  Auto-fill Manager
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Use the credentials above to use the portal.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer Note */}
        <footer className="login-footer">
          <span>Protected with Argon2id &amp; custom database sessions</span>
          <span style={{ margin: '0 6px' }}>•</span>
          <span>Sejuk Sejuk Service</span>
        </footer>
      </div>
    </main>
  );
}
