import React, { useEffect } from 'react';

const VARIANTS = {
  info: 'ui-toast ui-toast-info',
  success: 'ui-toast ui-toast-success',
  error: 'ui-toast ui-toast-error',
};

export default function Toast({ message, variant = 'info', duration = 4000, onDismiss }) {
  useEffect(() => {
    if (!message || !duration) return undefined;
    const timer = window.setTimeout(() => onDismiss?.(), duration);
    return () => window.clearTimeout(timer);
  }, [message, duration, onDismiss]);

  if (!message) return null;

  return (
    <div className={VARIANTS[variant] || VARIANTS.info} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="ui-toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
