import React, { useEffect } from 'react';
import Button from './Button';

export default function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'ui-modal-title' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="ui-modal-header">
            <h2 id="ui-modal-title">{title}</h2>
            <button type="button" className="ui-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ModalActions({ children }) {
  return <div className="ui-modal-actions">{children}</div>;
}

export { Button };
