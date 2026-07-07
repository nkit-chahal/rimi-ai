import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { trackEvent } from '../../observability';
import { cacheMediaFromResponse } from '../components/studio/shared/helpers';

const BgTaskContext = createContext(null);

const MAX_TASKS = 20;
const STALE_MS = 5 * 60 * 1000;

export function BgTaskProvider({ children }) {
    const [bgTasks, setBgTasks] = useState([]);
    const tasksRef = useRef(bgTasks);
    tasksRef.current = bgTasks;

    const addBgTask = useCallback((type, label, filename, triggerFn) => {
        const taskId = Date.now().toString();
        const newTask = {
            id: taskId,
            type,
            label,
            status: 'running',
            progress: 0,
            stage: '',
            filename: filename || 'design_input.png',
            resultUrl: null,
            resultUrls: null,
            fileAccessToken: null,
            error: null,
            createdAt: new Date().toLocaleTimeString(),
            _ts: Date.now(),
        };

        setBgTasks(prev => [newTask, ...prev].slice(0, MAX_TASKS));

        const reportProgress = (progressPct, stage) => {
            setBgTasks(prev => prev.map(t => t.id === taskId ? {
                ...t,
                progress: Math.min(99, progressPct ?? t.progress),
                stage: stage ?? t.stage,
            } : t));
        };

        triggerFn(reportProgress)
            .then((result) => {
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
