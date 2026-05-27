import React, { useState } from 'react';

export default function Login({ onLogin, onGoToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [autofillTrigger, setAutofillTrigger] = useState(false);

  const handleLogin = (e) => {
    if (e) e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setIsLoading(true);

    // Simulate slight loading delay for premium feel
    setTimeout(() => {
      if (email === 'admin@rimi.ai' && password === 'admin123') {
        onLogin({
          email: 'admin@rimi.ai',
          role: 'admin',
          name: 'System Administrator',
          initials: 'SA',
          plan: 'Admin Workspace',
          creditsUsed: 12050,
          creditsLimit: 25000,
          resetDays: 14
        });
      } else if (email === 'business@rimi.ai' && password === 'password123') {
        onLogin({
          email: 'business@rimi.ai',
          role: 'user',
          name: 'Business Designer',
          initials: 'BD',
          plan: 'Business Studio',
          creditsUsed: 4200,
          creditsLimit: 10000,
          resetDays: 18
        });
      } else {
        setError('Invalid email or password.');
        setIsLoading(false);
      }
    }, 800);
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
              <span>Or Select a Role to Autofill</span>
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
                  <span>Standard access levels</span>
                </div>
              </button>

              <button
                type="button"
                className="login-demo-btn admin"
                onClick={() => loadDemo('admin')}
                title="Log in as System Administrator (Admin Role)"
              >
                <div className="demo-icon admin-icon">SA</div>
                <div className="demo-text">
                  <strong>System Administrator</strong>
                  <span>Full control panel access</span>
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
