import React from 'react';
import { isProUser } from './planTiers';

/** Full-tool lock overlay for Pro-only studio tools. */
export default function ProToolLock({ user, featureName = 'This tool', onOpenBilling }) {
  if (isProUser(user)) return null;

  return (
    <div
      className="st-pro-lock"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(28, 25, 23, 0.55)',
        backdropFilter: 'blur(4px)',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          background: 'var(--card, #FAF8F5)',
          border: '1px solid var(--border, rgba(68,64,60,0.14))',
          borderRadius: 12,
          padding: '1.5rem',
          textAlign: 'center',
          boxShadow: '0 12px 40px rgba(28,25,23,0.18)',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#7c3aed',
            background: 'rgba(139,92,246,0.12)',
            padding: '0.25rem 0.55rem',
            borderRadius: 999,
            marginBottom: '0.75rem',
          }}
        >
          Pro
        </div>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem', color: 'var(--text, #1C1917)' }}>
          {featureName} is Pro
        </h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--muted, #78716C)', lineHeight: 1.45 }}>
          Upgrade with a Pro or Scale credit pack to unlock premium models, Qwen Studio, and 3D Mockup.
        </p>
        {typeof onOpenBilling === 'function' && (
          <button
            type="button"
            className="st-export-btn primary"
            onClick={onOpenBilling}
            style={{ cursor: 'pointer' }}
          >
            View Pro plans
          </button>
        )}
      </div>
    </div>
  );
}
