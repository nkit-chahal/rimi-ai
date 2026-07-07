import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Studio from './pages/Studio';
import { normalizeToken } from './components/studio/shared/helpers';
import { AuthProvider } from './contexts/AuthContext';

const Login = lazy(() => import('./pages/Login'));
const SharePage = lazy(() => import('./pages/SharePage'));

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
  const [isBootEntry, setIsBootEntry] = useState(() => Boolean(initialSession.user && initialSession.token));

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

  useEffect(() => {
    const onSessionExpired = () => handleLogout();
    window.addEventListener('rim:session-expired', onSessionExpired);
    return () => window.removeEventListener('rim:session-expired', onSessionExpired);
  }, []);

  return (
    <AuthProvider user={currentUser} token={currentToken} onLogin={handleLogin} onLogout={handleLogout}>
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
          <Route path="/share/:token" element={<Suspense fallback={null}><SharePage /></Suspense>} />
          <Route
            path="/login"
            element={currentUser ? <Navigate to="/studio" replace /> : <Suspense fallback={null}><Login onLogin={handleLogin} /></Suspense>}
          />
          <Route path="*" element={<Navigate to={currentUser ? '/studio' : '/login'} replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
