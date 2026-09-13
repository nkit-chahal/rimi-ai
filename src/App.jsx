import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Studio from './pages/Studio';
import { normalizeToken } from './components/studio/shared/helpers';
import { AuthProvider } from './contexts/AuthContext';
import { BgTaskProvider } from './contexts/BgTaskContext';
import { STUDIO_DOMAINS, canEnterDomain, clearStoredDomain, resolveInitialDomain, storeDomain, toolFromPathname } from './components/studio/shared/studioDomains';
import { trackEvent } from './observability';

const Login = lazy(() => import('./pages/Login'));
const SharePage = lazy(() => import('./pages/SharePage'));
const StudioSelect = lazy(() => import('./pages/StudioSelect'));

/** One-time migrate legacy hash URLs (#/login, #/studio/…) to path URLs. */
function migrateLegacyHashRoute() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw.startsWith('/')) return;
  const next = `${raw}${window.location.search || ''}`;
  window.history.replaceState(null, '', next);
}

migrateLegacyHashRoute();

/** Preserve OAuth query params when sending unauthenticated users to /login. */
function LoginRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/login', search: location.search }} replace />;
}

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
    // Keep the null fallback when browser storage is unavailable.
  }
  if (user && !token) {
    localStorage.removeItem('rim_user');
    return { user: null, token: null };
  }
  return { user, token };
}

function AppRoutes() {
  const navigate = useNavigate();
  const [initialSession] = useState(() => readInitialSession());
  const [currentUser, setCurrentUser] = useState(() => initialSession.user);
  const [currentToken, setCurrentToken] = useState(() => initialSession.token);
  const [isBootEntry, setIsBootEntry] = useState(() => Boolean(initialSession.user && initialSession.token));
  // Active studio (print / embroidery / woven). Null means the picker is shown first.
  const [studioDomain, setStudioDomain] = useState(() => (
    initialSession.user ? resolveInitialDomain(initialSession.user, window.location.pathname) : null
  ));

  const handleLogin = useCallback((user, token) => {
    const cleanToken = normalizeToken(token);
    if (!cleanToken) {
      setCurrentUser(null);
      setCurrentToken(null);
      localStorage.removeItem('rim_user');
      localStorage.removeItem('rim_token');
      navigate('/login', { replace: true });
      return;
    }
    setCurrentUser(user);
    setCurrentToken(cleanToken);
    localStorage.setItem('rim_token', cleanToken);
    localStorage.setItem('rim_user', JSON.stringify(user));
    clearStoredDomain();
    setStudioDomain(null);
    setIsBootEntry(true);
    navigate('/studio', { replace: true });
  }, [navigate]);

  const handleBootComplete = useCallback(() => {
    setIsBootEntry(false);
  }, []);

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    setCurrentToken(null);
    localStorage.removeItem('rim_user');
    localStorage.removeItem('rim_token');
    clearStoredDomain();
    setStudioDomain(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const handleSelectStudio = useCallback((domainId, options = {}) => {
    if (!canEnterDomain(domainId, currentUser)) return;
    storeDomain(domainId);
    setStudioDomain(domainId);
    trackEvent('studio_domain_selected', { domain: domainId });
    const requestedTool = options.tool || null;
    if (requestedTool) {
      navigate(`/studio/${requestedTool}`, { replace: true });
    } else if (!toolFromPathname(window.location.pathname)) {
      navigate(`/studio/${STUDIO_DOMAINS[domainId].defaultTool}`, { replace: true });
    }
  }, [currentUser, navigate]);

  const handleUserRefresh = useCallback((patch) => {
    if (!currentUser || !patch) return;
    const next = { ...currentUser };
    let changed = false;
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined && next[key] !== value) {
        next[key] = value;
        changed = true;
      }
    });
    if (!changed) return;
    setCurrentUser(next);
    localStorage.setItem('rim_user', JSON.stringify(next));
  }, [currentUser]);

  const handleSwitchStudio = useCallback(() => {
    clearStoredDomain();
    setStudioDomain(null);
    navigate('/studio', { replace: true });
  }, [navigate]);

  useEffect(() => {
    const onSessionExpired = () => handleLogout();
    window.addEventListener('rim:session-expired', onSessionExpired);
    return () => window.removeEventListener('rim:session-expired', onSessionExpired);
  }, [handleLogout]);

  return (
    <AuthProvider user={currentUser} token={currentToken} onLogin={handleLogin} onLogout={handleLogout}>
      <BgTaskProvider key={currentUser?.id || 'anonymous'} currentUserId={currentUser?.id} token={currentToken}>
        <Routes>
        <Route
          path="/studio/*"
          element={
            !currentUser ? (
              <Navigate to="/login" replace />
            ) : currentUser.role !== 'admin' && !studioDomain ? (
              <Suspense fallback={null}>
                <StudioSelect user={currentUser} onSelect={handleSelectStudio} onLogout={handleLogout} />
              </Suspense>
            ) : (
              <Studio
                key={studioDomain || 'admin'}
                currentUser={currentUser}
                currentToken={currentToken}
                onLogout={handleLogout}
                isBootEntry={isBootEntry}
                onBootComplete={handleBootComplete}
                activeDomain={studioDomain || 'print'}
                onSwitchStudio={handleSwitchStudio}
                onUserRefresh={handleUserRefresh}
              />
            )
          }
        />
        <Route path="/share/:token" element={<Suspense fallback={null}><SharePage /></Suspense>} />
        <Route
          path="/login"
          element={currentUser ? <Navigate to="/studio" replace /> : <Suspense fallback={null}><Login onLogin={handleLogin} /></Suspense>}
        />
        <Route path="/" element={currentUser ? <Navigate to="/studio" replace /> : <LoginRedirect />} />
        <Route path="*" element={currentUser ? <Navigate to="/studio" replace /> : <LoginRedirect />} />
        </Routes>
      </BgTaskProvider>
    </AuthProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
