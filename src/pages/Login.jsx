import React, { useEffect, useRef, useState } from 'react';
import { API, normalizeToken, prefetchStudioState } from '../components/studio/shared/helpers';
import { t } from '../i18n/en-IN';
import '../styles/landing.css';

function readGooglePhaseFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('google_login_token')) return 'completing';
  if (params.get('google_signup_token')) return 'signup';
  return null;
}

function clearAuthQueryParams() {
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
}

function generateFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#f60";
      ctx.fillRect(10, 10, 50, 50);
      ctx.fillStyle = "#069";
      ctx.fillText("rimi_fp_1", 10, 30);
    }
    const canvasData = canvas.toDataURL();
    const components = [
      navigator.userAgent,
      navigator.language,
      navigator.platform,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      canvasData
    ];
    const str = components.join('|');
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  } catch (e) {
    return 'err_' + Date.now();
  }
}

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [googleSignupToken, setGoogleSignupToken] = useState('');
  const [googleSignupEmail, setGoogleSignupEmail] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googlePhase, setGooglePhase] = useState(readGooglePhaseFromUrl);
  const [isRegisteredDevice, setIsRegisteredDevice] = useState(false);
  const oauthHandledRef = useRef(false);
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;

  useEffect(() => {
    try {
      if (localStorage.getItem('__rimi_registered') === '1') {
        setIsRegisteredDevice(true);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (oauthHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('google_error');
    const googleLoginToken = params.get('google_login_token');
    const googleSignupTokenParam = params.get('google_signup_token');

    if (googleError) {
      oauthHandledRef.current = true;
      setError(googleError);
      setGooglePhase(null);
      clearAuthQueryParams();
      return;
    }

    if (googleSignupTokenParam) {
      oauthHandledRef.current = true;
      setGooglePhase('signup');

      const loadGoogleSignup = async () => {
        setError('');
        try {
          const res = await fetch(`${API}/api/auth/google/signup-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: googleSignupTokenParam }),
          });
          const data = await res.json();
          if (!data.success) {
            setError(data.error || 'Google signup could not be completed.');
            clearAuthQueryParams();
            setGooglePhase(null);
            return;
          }
          clearAuthQueryParams();
          setGoogleSignupToken(googleSignupTokenParam);
          setGoogleSignupEmail(data.email || '');
          setEmail(data.email || '');
          setName(data.name || '');
          setPassword('');
          setConfirmPassword('');
          setMode('googleSetup');
          setNotice('Google verified your email. Set a password to finish signup.');
          setGooglePhase(null);
        } catch {
          setError('Unable to complete Google signup. Please try again.');
          clearAuthQueryParams();
          setGooglePhase(null);
        }
      };

      loadGoogleSignup();
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
          try {
            localStorage.setItem('__rimi_registered', '1');
          } catch (e) {
            console.error(e);
          }
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

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
    setDevOtp('');
  };

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setNotice('');

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
        try {
          localStorage.setItem('__rimi_registered', '1');
        } catch (e) {
          console.error(e);
        }
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

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setDevOtp('');

    if (!name || !email || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API}/api/signup/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, fingerprint: generateFingerprint() }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Could not start signup.');
        return;
      }
      setPendingEmail(email.trim());
      setNotice(data.message || 'Verification code sent. Check your email.');
      if (data.devOtp) setDevOtp(data.devOtp);
      setMode('verify');
    } catch {
      setError('Unable to connect to server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (!pendingEmail || !otp) {
      setError('Enter the verification code.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API}/api/signup/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, otp, fingerprint: generateFingerprint() }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Verification failed.');
        return;
      }
      try {
        localStorage.setItem('__rimi_registered', '1');
        setIsRegisteredDevice(true);
      } catch (e) {
        console.error(e);
      }
      setNotice(data.message || 'Email verified. You can sign in now.');
      setMode('signin');
      setPassword('');
      setConfirmPassword('');
      setOtp('');
      setDevOtp('');
    } catch {
      setError('Unable to connect to server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteGoogleSignup = async (e) => {
    e.preventDefault();
    setError('');

    if (!googleSignupToken || !name || !password || !confirmPassword) {
      setError('Name and password are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/google/complete-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: googleSignupToken, name: name.trim(), password, fingerprint: generateFingerprint() }),
      });
      const data = await res.json();
      if (data.success && data.user && normalizeToken(data.token)) {
        try {
          localStorage.setItem('__rimi_registered', '1');
          setIsRegisteredDevice(true);
        } catch (e) {
          console.error(e);
        }
        prefetchStudioState(data.token);
        onLogin(data.user, data.token);
        return;
      }
      setError(data.error || 'Could not complete Google signup.');
    } catch {
      setError('Unable to connect to server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (googlePhase) return;
    setError('');
    setNotice('');
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
      signup: {
        title: 'Verifying Google account',
        detail: 'Preparing your signup details…',
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

  const renderStatus = () => (
    <>
      {isRegisteredDevice && (mode === 'signup' || mode === 'googleSetup' || mode === 'verify') && (
        <div className="login-warning-badge" style={{
          background: 'rgba(245, 158, 11, 0.15)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          color: '#fbbf24',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px'
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <span>Note: A free trial account has already been registered from this browser/device.</span>
        </div>
      )}
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
      {notice && <div className="login-notice-badge">{notice}</div>}
      {import.meta.env.DEV && devOtp && (
        <div className="login-dev-otp">{t('login.devOtp')}: <strong>{devOtp}</strong></div>
      )}
    </>
  );

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
            <h2>{mode === 'signin' ? t('login.welcomeBack') : mode === 'googleSetup' ? t('login.finishGoogleSignup') : t('login.verifyEmail')}</h2>
            <p>{mode === 'verify' ? `Enter the code sent to ${pendingEmail}.` : mode === 'googleSetup' ? `Verified Google email: ${googleSignupEmail}` : t('login.subtitle')}</p>
          </div>

          {mode !== 'verify' && mode !== 'googleSetup' && (
            <div className="login-mode-tabs">
              <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>{t('login.signIn')}</button>
              <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>{t('login.signUp')}</button>
            </div>
          )}

          {mode === 'signin' && (
            <form onSubmit={handleLogin} className="login-form">
              {renderStatus()}
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
          )}

          {mode === 'signup' && (
            <form onSubmit={handleSignup} className="login-form">
              {renderStatus()}
              <div className="login-field">
                <label htmlFor="signup-name">Name</label>
                <div className="login-input-wrapper">
                  <input type="text" id="signup-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="login-input" required />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="signup-email">Email</label>
                <div className="login-input-wrapper">
                  <input type="email" id="signup-email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="login-input" required />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="signup-password">Password</label>
                <div className="login-input-wrapper">
                  <input type="password" id="signup-password" placeholder="Minimum 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} className="login-input" required />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="signup-confirm-password">Confirm Password</label>
                <div className="login-input-wrapper">
                  <input type="password" id="signup-confirm-password" placeholder="Repeat password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="login-input" required />
                </div>
              </div>
              <button type="submit" className="login-submit-btn" disabled={isLoading}>
                <span>{isLoading ? 'Sending code...' : 'Send verification code'}</span>
              </button>
            </form>
          )}

          {mode === 'verify' && (
            <form onSubmit={handleVerifyOtp} className="login-form">
              {renderStatus()}
              <div className="login-field">
                <label htmlFor="signup-otp">Verification Code</label>
                <div className="login-input-wrapper">
                  <input type="text" id="signup-otp" inputMode="numeric" maxLength="6" placeholder="000000" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="login-input login-otp-input" required />
                </div>
              </div>
              <button type="submit" className="login-submit-btn" disabled={isLoading}>
                <span>{isLoading ? 'Verifying...' : 'Verify and create account'}</span>
              </button>
              <button type="button" className="login-link-btn" onClick={() => switchMode('signup')}>Change signup details</button>
            </form>
          )}

          {mode === 'googleSetup' && (
            <form onSubmit={handleCompleteGoogleSignup} className="login-form">
              {renderStatus()}
              <div className="login-field">
                <label htmlFor="google-email">Verified Email</label>
                <div className="login-input-wrapper">
                  <input type="email" id="google-email" value={googleSignupEmail} className="login-input" disabled />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="google-name">Username / Name</label>
                <div className="login-input-wrapper">
                  <input type="text" id="google-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="login-input" required />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="google-password">Password</label>
                <div className="login-input-wrapper">
                  <input type="password" id="google-password" placeholder="Minimum 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} className="login-input" required />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="google-confirm-password">Confirm Password</label>
                <div className="login-input-wrapper">
                  <input type="password" id="google-confirm-password" placeholder="Repeat password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="login-input" required />
                </div>
              </div>
              <button type="submit" className="login-submit-btn" disabled={isLoading}>
                <span>{isLoading ? 'Creating account...' : 'Create account'}</span>
              </button>
              <button type="button" className="login-link-btn" onClick={() => switchMode('signin')}>Back to sign in</button>
            </form>
          )}

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
