import { useState, useEffect, useCallback } from 'react';
import './index.css';
import Studio from './pages/Studio';
import Login from './pages/Login';
import { normalizeToken } from './components/studio/shared/helpers';

function readSavedUser() {
  try {
    const saved = localStorage.getItem('rim_user');
    if (!saved) return null;

    const user = JSON.parse(saved);
    if (!user?.id) {
      localStorage.removeItem('rim_user');
      localStorage.removeItem('rim_token');
      return null;
    }

    return user;
  } catch {
    localStorage.removeItem('rim_user');
    localStorage.removeItem('rim_token');
    return null;
  }
}

function readInitialSession() {
  const user = readSavedUser();
  let token = null;
  try {
    token = normalizeToken(localStorage.getItem('rim_token'));
  } catch {
    token = null;
  }
  // Drop stale user cache when the session token is missing
  if (user && !token) {
    localStorage.removeItem('rim_user');
    return { user: null, token: null };
  }
  return { user, token };
}

function App() {
  const [initialSession] = useState(() => readInitialSession());
  const [view, setView] = useState(() => (initialSession.user ? 'studio' : 'login'));
  const [currentUser, setCurrentUser] = useState(() => initialSession.user);
  const [currentToken, setCurrentToken] = useState(() => initialSession.token);
  const [isBootEntry, setIsBootEntry] = useState(false);

  const handleLogin = useCallback((user, token) => {
    const cleanToken = normalizeToken(token);
    if (!cleanToken) {
      setCurrentUser(null);
      setCurrentToken(null);
      localStorage.removeItem('rim_user');
      localStorage.removeItem('rim_token');
      setView('login');
      return;
    }
    setCurrentUser(user);
    setCurrentToken(cleanToken);
    localStorage.setItem('rim_token', cleanToken);
    localStorage.setItem('rim_user', JSON.stringify(user));
    setIsBootEntry(true);
    setView('studio');
  }, []);

  const handleBootComplete = useCallback(() => {
    setIsBootEntry(false);
  }, []);

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentToken(null);
    localStorage.removeItem('rim_user');
    localStorage.removeItem('rim_token');
    window.location.hash = '';
    setView('login');
  };

  // Auto-logout when JWT expires (401 from any API call)
  useEffect(() => {
    const onSessionExpired = () => handleLogout();
    window.addEventListener('rim:session-expired', onSessionExpired);
    return () => window.removeEventListener('rim:session-expired', onSessionExpired);
  }, []);

  if (view === 'studio') {
    if (!currentUser) {
      return <Login onLogin={handleLogin} />;
    }
    return (
      <Studio
        currentUser={currentUser}
        currentToken={currentToken}
        onLogout={handleLogout}
        isBootEntry={isBootEntry}
        onBootComplete={handleBootComplete}
      />
    );
  }

  return <Login onLogin={handleLogin} />;
}

export default App;
