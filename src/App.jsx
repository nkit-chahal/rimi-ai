import { useState, useEffect, useCallback } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import Studio from './pages/Studio';
import Login from './pages/Login';
import SharePage from './pages/SharePage';
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
    window.location.hash = '#/studio';
  }, []);

  const handleBootComplete = useCallback(() => {
    setIsBootEntry(false);
  }, []);

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentToken(null);
    localStorage.removeItem('rim_user');
    localStorage.removeItem('rim_token');
    window.location.hash = '#/login';
    setView('login');
  };

  // Auto-logout when JWT expires (401 from any API call)
  useEffect(() => {
    const onSessionExpired = () => handleLogout();
    window.addEventListener('rim:session-expired', onSessionExpired);
    return () => window.removeEventListener('rim:session-expired', onSessionExpired);
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/studio/*"
          element={
            currentUser ? (
              <Studio
                currentUser={currentUser}
                currentToken={currentToken}
                onLogout={handleLogout}
                isBootEntry={isBootEntry}
                onBootComplete={handleBootComplete}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="/share/:token" element={<SharePage />} />
        <Route
          path="/login"
          element={currentUser ? <Navigate to="/studio" replace /> : <Login onLogin={handleLogin} />}
        />
        <Route path="*" element={<Navigate to={currentUser ? '/studio' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
