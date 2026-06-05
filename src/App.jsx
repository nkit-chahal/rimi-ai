import { useState, useEffect } from 'react';
import './index.css';
import Studio from './pages/Studio';
import Login from './pages/Login';

function App() {
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('rim_user');
    return saved ? 'studio' : 'login';
  });
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('rim_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
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

  return (
    <Login 
      onLogin={handleLogin} 
    />
  );
}

export default App;
