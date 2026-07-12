import React, { useEffect, useRef, useState } from 'react';
import { API, normalizeToken, prefetchStudioState } from '../components/studio/shared/helpers';
import { t } from '../i18n/en-IN';
import '../styles/login.css';

function readGooglePhaseFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('google_login_token')) return 'completing';
  return null;
}

function clearAuthQueryParams() {
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
}

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googlePhase, setGooglePhase] = useState(readGooglePhaseFromUrl);
  const oauthHandledRef = useRef(false);
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;

  useEffect(() => {
    if (oauthHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('google_error');
    const googleLoginToken = params.get('google_login_token');

    if (googleError) {
      oauthHandledRef.current = true;
      setError(googleError);
      setGooglePhase(null);
      clearAuthQueryParams();
      return;
    }

    if (!googleLoginToken) return;

    oauthHandledRef.current = true;
    setGooglePhase('completing');

    const exchangeGoogleToken = async () => {
      setError('');
      try {
        const res = await fetch(`${API}/api/auth/google/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: googleLoginToken }),
        });
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (res.ok && data?.success && data.user && normalizeToken(data.token)) {
          clearAuthQueryParams();
          prefetchStudioState(data.token);
          onLoginRef.current(data.user, data.token);
          return;
        }
        clearAuthQueryParams();
        setError(data?.error || 'Google login could not be completed. Please try again.');
        setGooglePhase(null);
      } catch {
        clearAuthQueryParams();
        setError('Unable to complete Google login. Check your connection and try again.');
        setGooglePhase(null);
      }
    };

    exchangeGoogleToken();
  }, []);

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();

      if (data.success && data.user && normalizeToken(data.token)) {
        prefetchStudioState(data.token);
        onLogin(data.user, data.token);
      } else if (data.success && data.user) {
        setError('Login succeeded but no session token was returned. Please try again.');
        setIsLoading(false);
      } else {
        setError(data.error || 'Invalid email or password.');
        setIsLoading(false);
      }
    } catch {
      setError('Unable to connect to server. Please try again.');
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (googlePhase) return;
    setError('');
    setGooglePhase('redirecting');
    window.setTimeout(() => {
      window.location.href = `${API}/api/auth/google/start`;
    }, 80);
  };

  const renderGoogleOverlay = () => {
    if (!googlePhase) return null;
    const messages = {
      redirecting: {
        title: 'Redirecting to Google',
        detail: 'Opening secure Google sign-in…',
      },
      completing: {
        title: 'Completing sign in',
        detail: 'Verifying your account and opening the studio…',
      },
    };
    const copy = messages[googlePhase] || messages.completing;

    return (
      <div className="login-oauth-overlay" role="status" aria-live="polite">
        <div className="login-oauth-spinner" aria-hidden="true" />
        <strong>{copy.title}</strong>
        <p>{copy.detail}</p>
      </div>
    );
  };

  return (
    <div className="login-portal">
      <aside className="login-stage">
        <div className="login-stage-pattern" aria-hidden="true" />
        <div className="login-stage-veil" aria-hidden="true" />
        <div className="login-stage-copy">
          <p className="login-stage-kicker">Textile &amp; surface design</p>
          <h1 className="login-stage-brand">{t('appName')}</h1>
          <p className="login-stage-lead">
            Extract motifs, build seamless repeats, map colorways, and export print-ready files —
            one studio for production teams.
          </p>
          <ul className="login-stage-points">
            <li>Repeat sets in real fabric widths</li>
            <li>Colorways &amp; Pantone-aware workflows</li>
            <li>Credits-based AI tools, INR billing</li>
          </ul>
        </div>
      </aside>

      <main className="login-panel">
        <div className={`login-sheet ${googlePhase ? 'is-oauth-busy' : ''}`}>
          {renderGoogleOverlay()}

          <header className="login-sheet-head">
            <span className="login-mark" aria-hidden="true">R</span>
            <div>
              <h2>Sign in</h2>
              <p>Continue to your pattern studio</p>
            </div>
          </header>

          <form onSubmit={handleLogin} className="login-form">
            {error && (
              <div className="login-error-badge" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                autoComplete="email"
                placeholder="name@studio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
                required
              />
            </div>

            <button type="submit" className="login-submit-btn" disabled={isLoading || Boolean(googlePhase)}>
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="login-oauth-section">
            <div className="login-quick-divider"><span>or</span></div>
            <button
              type="button"
              className="login-google-btn"
              onClick={handleGoogleLogin}
              disabled={isLoading || Boolean(googlePhase)}
            >
              <svg className="login-google-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>
                {googlePhase === 'redirecting'
                  ? 'Opening Google…'
                  : googlePhase === 'completing'
                    ? 'Completing sign in…'
                    : 'Continue with Google'}
              </span>
            </button>
          </div>

          <p className="login-footnote">© 2026 RIMI AI · Built for print production</p>
        </div>
      </main>
    </div>
  );
}
