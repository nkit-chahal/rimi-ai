import { useState } from 'react';
import './index.css';
import Landing from './pages/Landing';
import Studio from './pages/Studio';
import Login from './pages/Login';

function App() {
  const [view, setView] = useState('login');
  const [currentUser, setCurrentUser] = useState(null);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setView('studio');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView('login');
  };

  if (view === 'studio') {
    if (!currentUser) {
      return <Login onLogin={handleLogin} onGoToLanding={() => setView('landing')} />;
    }
    return (
      <Studio 
        currentUser={currentUser} 
        onBack={() => setView('landing')} 
        onLogout={handleLogout} 
      />
    );
  }

  if (view === 'landing') {
    return (
      <Landing 
        currentUser={currentUser} 
        onEnterApp={() => {
          if (currentUser) {
            setView('studio');
          } else {
            setView('login');
          }
        }} 
      />
    );
  }

  return (
    <Login 
      onLogin={handleLogin} 
      onGoToLanding={() => setView('landing')} 
    />
  );
}

export default App;

