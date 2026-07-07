import React, { useEffect, useRef, useState } from 'react';
import { API, normalizeToken, prefetchStudioState } from '../components/studio/shared/helpers';
import { t } from '../i18n/en-IN';
import '../styles/landing.css';

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
        detail: 'Verifying your Google account and starting your studio session…',
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
      <div className="login-bg-blobs">
        <div className="login-blob blob-1"></div>
        <div className="login-blob blob-2"></div>
      </div>
      <div className="login-grid-overlay"></div>

      <div className="login-container">
        <div className="login-brand">
          <span className="ln-logo-badge">RI</span>
          <span className="login-logo-text">{t('appName')}</span>
        </div>

        <div className={`login-card ${googlePhase ? 'is-oauth-busy' : ''}`}>
          {renderGoogleOverlay()}
          <div className="login-header">
            <h2>{t('login.welcomeBack')}</h2>
            <p>{t('login.subtitle')}</p>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            {error && (
              <div className="login-error-badge">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>{error}</span>
              </div>
            )}
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <div className="login-input-wrapper">
                <input type="email" id="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="login-input" required />
              </div>
            </div>
            <div className="login-field">
              <div className="login-field-header">
                <label htmlFor="password">Password</label>
              </div>
              <div className="login-input-wrapper">
                <input type="password" id="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="login-input" required />
              </div>
            </div>
            <button type="submit" className="login-submit-btn" disabled={isLoading || Boolean(googlePhase)}>
              <span>{isLoading ? 'Signing in...' : 'Sign in'}</span>
            </button>
          </form>

          <div className="login-oauth-section">
            <div className="login-quick-divider"><span>or</span></div>
            <button type="button" className="login-google-btn" onClick={handleGoogleLogin} disabled={isLoading || Boolean(googlePhase)}>
              <span className="login-google-icon" aria-hidden="true">G</span>
              <span>
                {googlePhase === 'redirecting' ? 'Opening Google…' : googlePhase === 'completing' ? 'Completing sign in…' : 'Continue with Google'}
              </span>
            </button>
          </div>
        </div>

        <div className="login-footer">
          <p>© 2026 RIMI AI. All Rights Reserved. Enterprise Grade Security.</p>
        </div>
      </div>
    </div>
  );
}
