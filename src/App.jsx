import { useState } from 'react';
import './index.css';
import Landing from './pages/Landing';
import Studio from './pages/Studio';

function App() {
  const [view, setView] = useState('landing');
  
  if (view === 'studio') {
    return <Studio onBack={() => setView('landing')} />;
  }
  return <Landing onEnterApp={() => setView('studio')} />;
}

export default App;
