import React from 'react';
import { useTimedProgress } from './useTimedProgress';

/**
 * Model-aware AI loading UI with a timed progress bar.
 * Replaces the old infinite ring spinner that felt broken.
 */
export default function ModelLoadingBar({
    active = false,
    modelId = null,
    toolType = null,
    expectedMs = null,
    multiplier = 1,
    serverProgress = null,
    label = null,
    accent = '#6366f1',
    compact = false,
    tone = 'default',
    className = '',
    children = null,
}) {
    const { progress, etaLabel, rangeLabel, modelLabel } = useTimedProgress({
        active,
        modelId,
        toolType,
        expectedMs,
        multiplier,
        serverProgress,
    });

    if (!active) return null;

    const title = label || (modelLabel ? `${modelLabel}…` : 'Processing…');
    const pct = Math.max(0, Math.min(100, Math.round(progress)));

    return (
        <div
            className={`st-model-loading ${compact ? 'is-compact' : ''} ${tone === 'light' ? 'is-light' : ''} ${className}`.trim()}
            style={{ '--ml-accent': accent }}
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            {!compact && (
                <div className="st-model-loading-orb" aria-hidden="true">
                    <span className="st-model-loading-orb-core" />
                    <span className="st-model-loading-orb-ring" />
                    <span className="st-model-loading-orb-ring" />
                </div>
            )}

            <div className="st-model-loading-copy">
                <strong className="st-model-loading-title">{title}</strong>
                {(etaLabel || rangeLabel) && (
                    <span className="st-model-loading-meta">
                        {etaLabel || rangeLabel}
                        {etaLabel && rangeLabel ? ` · ${rangeLabel}` : ''}
                    </span>
                )}
            </div>

            <div className="st-model-loading-track" aria-hidden="true">
                <div
                    className="st-model-loading-fill"
                    style={{ width: `${pct}%` }}
                />
                <div className="st-model-loading-shimmer" />
            </div>

            <div className="st-model-loading-pct">{pct}%</div>

            {children}
        </div>
    );
}
