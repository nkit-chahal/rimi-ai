import { useState, useEffect } from 'react';
import './index.css';
// import Landing from './pages/Landing'; // Landing page disabled — not used in product
import Studio from './pages/Studio';
import Login from './pages/Login';

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

function App() {
  const [view, setView] = useState(() => {
    return readSavedUser() ? 'studio' : 'login';
  });
  const [currentUser, setCurrentUser] = useState(() => readSavedUser());
  const [currentToken, setCurrentToken] = useState(() => {
    try {
      const saved = localStorage.getItem('rim_token');
      return saved ? saved : null;
    } catch {
      return null;
    }
  });

  const handleLogin = (user, token) => {
    setCurrentUser(user);
    if (token) {
      setCurrentToken(token);
      localStorage.setItem('rim_token', token);
    }
    localStorage.setItem('rim_user', JSON.stringify(user));
    setView('studio');
  };

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
      />
    );
  }

  return <Login onLogin={handleLogin} />;
}

export default App;
