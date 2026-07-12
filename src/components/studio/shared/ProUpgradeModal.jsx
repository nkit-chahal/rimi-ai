import React, { useEffect } from 'react';

/**
 * Lightweight Pro-gate dialog for model pickers.
 * Shows an explanation + optional billing CTA — never auto-navigates.
 */
export default function ProUpgradeModal({
  open,
  modelName,
  onClose,
  onViewPlans,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const label = modelName ? `${modelName}` : 'This model';

  return (
    <div
      className="st-modal-overlay st-pro-upgrade-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="st-pro-upgrade-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="st-pro-upgrade-modal">
        <span className="st-pro-upgrade-badge">Pro</span>
        <h3 id="st-pro-upgrade-title">{label} needs Pro</h3>
        <p>
          Upgrade with a Pro or Scale credit pack to unlock this model and other premium features.
        </p>
        <div className="st-pro-upgrade-actions">
          <button type="button" className="st-btn" onClick={onClose}>
            Close
          </button>
          {typeof onViewPlans === 'function' && (
            <button
              type="button"
              className="st-btn primary"
              onClick={() => {
                onClose?.();
                onViewPlans();
              }}
            >
              View plans
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
