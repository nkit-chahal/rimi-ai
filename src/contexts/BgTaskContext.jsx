import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { trackEvent } from '../../observability';
import { cacheMediaFromResponse } from '../components/studio/shared/helpers';
import { getModelTiming, resolveModelId, timedProgressPct } from '../components/studio/shared/modelTimings';

const BgTaskContext = createContext(null);

const MAX_TASKS = 20;
const STALE_MS = 5 * 60 * 1000;

export function BgTaskProvider({ children }) {
    const [bgTasks, setBgTasks] = useState([]);
    const tasksRef = useRef(bgTasks);
    tasksRef.current = bgTasks;

    const addBgTask = useCallback((type, label, filename, triggerFn, options = {}) => {
        const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const modelId = resolveModelId(options.modelId, options.toolType || type);
        const timing = getModelTiming(modelId);
        const expectedMs = Math.max(
            800,
            (options.expectedMs ?? timing.expectedMs) * Math.max(1, options.multiplier || 1),
        );
        const newTask = {
            id: taskId,
            type,
            label,
            status: 'running',
            progress: 1,
            stage: timing.label || 'Processing…',
            modelId,
            expectedMs,
            filename: filename || 'design_input.png',
            resultUrl: null,
            resultUrls: null,
            fileAccessToken: null,
            error: null,
            createdAt: new Date().toLocaleTimeString(),
            _startedAt: Date.now(),
            _ts: Date.now(),
        };

        setBgTasks(prev => [newTask, ...prev].slice(0, MAX_TASKS));

        let serverProgress = 0;
        const reportProgress = (progressPct, stage) => {
            if (typeof progressPct === 'number') {
                serverProgress = Math.min(99, progressPct);
            }
            setBgTasks(prev => prev.map(t => t.id === taskId ? {
                ...t,
                progress: Math.min(99, Math.max(t.progress, serverProgress)),
                stage: stage ?? t.stage,
            } : t));
        };

        const tickId = window.setInterval(() => {
            setBgTasks(prev => prev.map(t => {
                if (t.id !== taskId || t.status !== 'running') return t;
                const elapsed = Date.now() - (t._startedAt || Date.now());
                const timed = timedProgressPct(elapsed, t.expectedMs || expectedMs);
                return {
                    ...t,
                    progress: Math.min(99, Math.max(timed, serverProgress, t.progress || 0)),
                };
            }));
        }, 120);

        triggerFn(reportProgress)
            .then((result) => {
                window.clearInterval(tickId);
                trackEvent('generation_complete', { tool: type, label, filename });
                if (result?.fileAccessToken && result?.url) {
                    cacheMediaFromResponse({ resultUrl: result.url, fileAccessToken: result.fileAccessToken });
                }
                setBgTasks(prev => prev.map(t => t.id === taskId ? {
                    ...t,
                    status: 'completed',
                    progress: 100,
                    resultUrl: result.url,
                    resultUrls: result.urls || null,
                    fileAccessToken: result.fileAccessToken || null,
                    _ts: Date.now(),
                } : t).slice(0, MAX_TASKS));
            })
            .catch((err) => {
                window.clearInterval(tickId);
                setBgTasks(prev => prev.map(t => t.id === taskId ? {
                    ...t,
                    status: 'failed',
                    progress: 0,
                    error: err.message || 'Generation failed',
                    _ts: Date.now(),
                } : t).slice(0, MAX_TASKS));
            });
    }, []);

    // Prune completed/failed tasks older than 5 minutes
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setBgTasks(prev => {
                const pruned = prev.filter(t =>
                    t.status === 'running' || (t._ts && now - t._ts < STALE_MS)
                );
                return pruned.length !== prev.length ? pruned : prev;
            });
        }, 60000);
        return () => clearInterval(interval);
    }, []);

    return (
        <BgTaskContext.Provider value={{ bgTasks, addBgTask }}>
            {children}
        </BgTaskContext.Provider>
    );
}

export function useBgTasks() {
    const ctx = useContext(BgTaskContext);
    if (!ctx) throw new Error('useBgTasks must be used within BgTaskProvider');
    return ctx;
}
