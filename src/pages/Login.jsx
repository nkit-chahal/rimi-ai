import React, { useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Login({ onLogin, onGoToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [autofillTrigger, setAutofillTrigger] = useState(false);

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

      if (data.success && data.user) {
        onLogin(data.user, data.token);
      } else {
        setError(data.error || 'Invalid email or password.');
        setIsLoading(false);
      }
    } catch (err) {
      setError('Unable to connect to server. Please try again.');
      setIsLoading(false);
    }
  };

  const loadDemo = (type) => {
    setError('');
    setAutofillTrigger(true);
    if (type === 'admin') {
      setEmail('admin@rimi.ai');
      setPassword('admin123');
    } else {
      setEmail('business@rimi.ai');
      setPassword('password123');
    }
    
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;

    setTimeout(() => {
      setAutofillTrigger(false);
    }, 600);
  };

  return (
    <div className="login-portal">
      {/* Background Animated Blurs */}
      <div className="login-bg-blobs">
        <div className="login-blob blob-1"></div>
        <div className="login-blob blob-2"></div>
      </div>
      <div className="login-grid-overlay"></div>

      <div className="login-container">
        {/* Branding */}
        <div className="login-brand" onClick={onGoToLanding}>
          <span className="ln-logo-badge">RI</span>
          <span className="login-logo-text">RIM AI</span>
        </div>

        {/* Card Panel */}
        <div className="login-card">
          <div className="login-header">
            <h2>Welcome Back</h2>
            <p>Access the premium generative pattern intelligence suite.</p>
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
              <label htmlFor="email">Work Email</label>
              <div className={`login-input-wrapper ${autofillTrigger ? 'autofill-animate' : ''}`}>
                <input
                  type="email"
                  id="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="login-input"
                  required
                />
              </div>
            </div>

            <div className="login-field">
              <div className="login-field-header">
                <label htmlFor="password">Password</label>
                <a href="#forgot" className="login-forgot" onClick={(e) => e.preventDefault()}>Forgot?</a>
              </div>
              <div className={`login-input-wrapper ${autofillTrigger ? 'autofill-animate' : ''}`}>
                <input
                  type="password"
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="login-input"
                  required
                />
              </div>
            </div>

            <button type="submit" className="login-submit-btn" disabled={isLoading}>
              {isLoading ? (
                <span className="login-spinner">Authenticating...</span>
              ) : (
                <span>Sign In to Studio</span>
              )}
            </button>
          </form>

          {/* Quick-auth selectors */}
          <div className="login-quick-auth">
            <div className="login-quick-divider">
              <span>Quick Login</span>
            </div>
            <div className="login-quick-buttons">
              <button
                type="button"
                className="login-demo-btn business"
                onClick={() => loadDemo('business')}
                title="Log in as Business User (Standard Role)"
              >
                <div className="demo-icon">BD</div>
                <div className="demo-text">
                  <strong>Business User</strong>
                  <span>Design tools access</span>
                </div>
              </button>

              <button
                type="button"
                className="login-demo-btn admin"
                onClick={() => loadDemo('admin')}
                title="Log in as System Administrator (Supervisor Role)"
              >
                <div className="demo-icon admin-icon">SA</div>
                <div className="demo-text">
                  <strong>Supervisor Admin</strong>
                  <span>Full control panel</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="login-footer">
          <p>© 2026 RIM AI. All Rights Reserved. Enterprise Grade Security.</p>
        </div>
      </div>
    </div>
  );
}
