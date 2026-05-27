import { useState } from 'react';
import './index.css';
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
      return <Login onLogin={handleLogin} />;
    }
    return (
      <Studio 
        currentUser={currentUser} 
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

