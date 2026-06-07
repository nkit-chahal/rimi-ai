import React, { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Login({ onLogin, onGoToLanding }) {
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('google_error');
    const googleLoginToken = params.get('google_login_token');
    const googleSignupTokenParam = params.get('google_signup_token');

    if (googleError) {
      setError(googleError);
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      return;
    }

    if (googleSignupTokenParam) {
      const loadGoogleSignup = async () => {
        setIsLoading(true);
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
            return;
          }
          window.history.replaceState(null, '', window.location.pathname + window.location.hash);
          setGoogleSignupToken(googleSignupTokenParam);
          setGoogleSignupEmail(data.email || '');
          setEmail(data.email || '');
          setName(data.name || '');
          setPassword('');
          setConfirmPassword('');
          setMode('googleSetup');
          setNotice('Google verified your email. Set a password to finish signup.');
        } catch {
          setError('Unable to complete Google signup. Please try again.');
        } finally {
          setIsLoading(false);
        }
      };

      loadGoogleSignup();
      return;
    }

    if (!googleLoginToken) return;

    const exchangeGoogleToken = async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch(`${API}/api/auth/google/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: googleLoginToken }),
        });
        const data = await res.json();
        if (data.success && data.user) {
          window.history.replaceState(null, '', window.location.pathname + window.location.hash);
          onLogin(data.user, data.token);
          return;
        }
        setError(data.error || 'Google login could not be completed.');
      } catch {
        setError('Unable to complete Google login. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    exchangeGoogleToken();
  }, [onLogin]);

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

      if (data.success && data.user) {
        onLogin(data.user, data.token);
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
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
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
        body: JSON.stringify({ email: pendingEmail, otp }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Verification failed.');
        return;
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
        body: JSON.stringify({ token: googleSignupToken, name: name.trim(), password }),
      });
      const data = await res.json();
      if (data.success && data.user) {
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
    setError('');
    window.location.href = `${API}/api/auth/google/start`;
  };

  const renderStatus = () => (
    <>
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
      {devOtp && <div className="login-dev-otp">Development OTP: <strong>{devOtp}</strong></div>}
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
        <div className="login-brand" onClick={onGoToLanding}>
          <span className="ln-logo-badge">RI</span>
          <span className="login-logo-text">RIMI AI</span>
        </div>

        <div className="login-card">
          <div className="login-header">
            <h2>{mode === 'signin' ? 'Welcome Back' : mode === 'googleSetup' ? 'Finish Google Signup' : 'Verify Email'}</h2>
            <p>{mode === 'verify' ? `Enter the code sent to ${pendingEmail}.` : mode === 'googleSetup' ? `Verified Google email: ${googleSignupEmail}` : 'Access the generative pattern intelligence studio.'}</p>
          </div>

          {false && mode !== 'verify' && mode !== 'googleSetup' && (
            <div className="login-mode-tabs">
              <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
              <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>Sign up</button>
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
              <button type="submit" className="login-submit-btn" disabled={isLoading}>
                <span>{isLoading ? 'Signing in...' : 'Sign in'}</span>
              </button>
            </form>
          )}

          {false && mode === 'signup' && (
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
            <button type="button" className="login-google-btn" onClick={handleGoogleLogin} disabled={isLoading}>
              <span className="login-google-icon" aria-hidden="true">G</span>
              <span>Continue with Google</span>
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
