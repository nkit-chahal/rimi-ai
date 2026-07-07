import React, { createContext, useContext } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ user, token, onLogin, onLogout, children }) {
  return (
    <AuthContext.Provider value={{ user, token, onLogin, onLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export default AuthContext;
