import React, { createContext, useContext } from 'react';

const CreditsContext = createContext(null);

export function CreditsProvider({ creditPricing, refreshPricing, children }) {
  return (
    <CreditsContext.Provider value={{ creditPricing, refreshPricing }}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCredits() {
  return useContext(CreditsContext);
}

export default CreditsContext;
