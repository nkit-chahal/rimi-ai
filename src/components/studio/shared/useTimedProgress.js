import { useEffect, useRef, useState } from 'react';
import {
    formatEta,
    getModelTiming,
    resolveModelId,
    timedProgressPct,
} from './modelTimings';

/**
 * Time-based progress for AI jobs when the server doesn't stream fine-grained %.
 * Optionally blends with serverProgress (takes the max so real job updates win).
 */
export function useTimedProgress({
    active = false,
    modelId = null,
    toolType = null,
    expectedMs: expectedMsOverride = null,
    multiplier = 1,
    serverProgress = null,
    tickMs = 100,
} = {}) {
    const [progress, setProgress] = useState(0);
    const [etaLabel, setEtaLabel] = useState('');
    const [rangeLabel, setRangeLabel] = useState('');
    const [modelLabel, setModelLabel] = useState('');
    const startedAtRef = useRef(0);

    const resolvedId = resolveModelId(modelId, toolType);
    const timing = getModelTiming(resolvedId);
    const expectedMs = Math.max(
        800,
        (expectedMsOverride ?? timing.expectedMs) * Math.max(1, multiplier),
    );

    useEffect(() => {
        if (!active) {
            setProgress(0);
            setEtaLabel('');
            setRangeLabel('');
            setModelLabel('');
            startedAtRef.current = 0;
            return undefined;
        }

        startedAtRef.current = Date.now();
        setModelLabel(timing.label || 'AI model');
        setRangeLabel(
            multiplier > 1
                ? `Usually ~${Math.round(expectedMs / 1000)}s for ${multiplier} runs`
                : formatUsualRangeLabel(timing),
        );
        setProgress(1);

        const id = window.setInterval(() => {
            const elapsed = Date.now() - startedAtRef.current;
            const timed = timedProgressPct(elapsed, expectedMs);
            const server = typeof serverProgress === 'number' ? Math.min(99, serverProgress) : 0;
            const next = Math.max(timed, server);
            setProgress(next);

            const remaining = Math.max(0, expectedMs - elapsed);
            // If server is ahead of schedule, shrink ETA
            const adjustedRemaining = server > timed
                ? remaining * Math.max(0.15, 1 - server / 100)
                : remaining;
            setEtaLabel(next >= 96 ? 'Finishing…' : formatEta(adjustedRemaining));
        }, tickMs);

        return () => window.clearInterval(id);
    }, [active, expectedMs, resolvedId, timing.label, multiplier, tickMs]);

    // Blend late server updates without restarting the timer
    useEffect(() => {
        if (!active || typeof serverProgress !== 'number') return;
        setProgress((prev) => Math.max(prev, Math.min(99, serverProgress)));
    }, [active, serverProgress]);

    return {
        progress: active ? progress : 0,
        etaLabel: active ? etaLabel : '',
        rangeLabel: active ? rangeLabel : '',
        modelLabel: active ? modelLabel : '',
        expectedMs,
        resolvedModelId: resolvedId,
    };
}

function formatUsualRangeLabel(timing) {
    const minS = Math.round((timing?.minMs || 0) / 1000);
    const maxS = Math.round((timing?.maxMs || 0) / 1000);
    if (!minS && !maxS) return '';
    if (maxS >= 60) {
        const minM = Math.max(1, Math.round(minS / 60));
        const maxM = Math.max(minM, Math.round(maxS / 60));
        return `Usually ${minM}–${maxM} min`;
    }
    if (minS === maxS) return `Usually ~${minS}s`;
    return `Usually ${minS}–${maxS}s`;
}
