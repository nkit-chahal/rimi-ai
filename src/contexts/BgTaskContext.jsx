import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { trackEvent } from '../observability';
import { cacheMediaFromResponse, waitForJob } from '../components/studio/shared/helpers';
import { getModelTiming, resolveModelId, timedProgressPct } from '../components/studio/shared/modelTimings';

const BgTaskContext = createContext(null);

const MAX_TASKS = 20;
const RECENT_TASK_MS = 30 * 60 * 1000;

function taskStorageKey(userId) {
    return `rimi:bg-tasks:${userId || 'anonymous'}`;
}

function resultFields(result = {}) {
    const urls = result.urls
        || result.layers?.map(item => item?.url).filter(Boolean)
        || result.tiles?.map(item => item?.url).filter(Boolean)
        || result.mockups?.map(item => item?.url).filter(Boolean)
        || null;
    return {
        resultUrl: result.url || result.resultUrl || result.imageUrl || urls?.[0] || null,
        resultUrls: urls?.length ? urls : null,
        sessionId: result.sessionId || null,
        fileAccessToken: result.fileAccessToken || null,
    };
}

function readSavedTasks(userId) {
    try {
        const raw = window.sessionStorage.getItem(taskStorageKey(userId));
        if (!raw) return [];
        const now = Date.now();
        return JSON.parse(raw)
            .filter(task => task?.id && (task.status === 'running' || now - (task._ts || task._startedAt || 0) < RECENT_TASK_MS))
            .slice(0, MAX_TASKS)
            .map(task => task.status === 'running' && !task.jobId ? {
                ...task,
                status: 'failed',
                progress: 0,
                stage: 'Interrupted',
                error: 'This task was interrupted by a page reload. Start it again from the tool.',
                _ts: now,
            } : task);
    } catch {
        return [];
    }
}

export function BgTaskProvider({ children, currentUserId, token }) {
    const [bgTasks, setBgTasks] = useState(() => readSavedTasks(currentUserId));
    const timersRef = useRef(new Map());
    const retryFnsRef = useRef(new Map());
    const resumedJobsRef = useRef(new Set());

    const finishTask = useCallback((taskId, result) => {
        cacheMediaFromResponse(result || {});
        const fields = resultFields(result);
        setBgTasks(prev => prev.map(task => task.id === taskId ? {
            ...task,
            ...fields,
            status: 'completed',
            progress: 100,
            stage: 'Complete',
            error: null,
            _ts: Date.now(),
        } : task).slice(0, MAX_TASKS));
    }, []);

    const failTask = useCallback((taskId, error) => {
        setBgTasks(prev => prev.map(task => task.id === taskId ? {
            ...task,
            status: 'failed',
            progress: 0,
            stage: 'Failed',
            error: error?.message || 'Generation failed',
            _ts: Date.now(),
        } : task).slice(0, MAX_TASKS));
    }, []);

    const addBgTask = useCallback((type, label, filename, triggerFn, options = {}) => {
        const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const modelId = resolveModelId(options.modelId, options.toolType || type);
        const timing = getModelTiming(modelId);
        const expectedMs = Math.max(800, (options.expectedMs ?? timing.expectedMs) * Math.max(1, options.multiplier || 1));
        const now = Date.now();
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
            sessionId: null,
            fileAccessToken: null,
            jobId: null,
            error: null,
            createdAt: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            _startedAt: now,
            _ts: now,
        };

        retryFnsRef.current.set(taskId, { type, label, filename, triggerFn, options });
        setBgTasks(prev => [newTask, ...prev].slice(0, MAX_TASKS));

        let serverProgress = 0;
        const reportProgress = (progressPct, stage, metadata = {}) => {
            if (typeof progressPct === 'number') serverProgress = Math.min(99, progressPct);
            setBgTasks(prev => prev.map(task => task.id === taskId ? {
                ...task,
                progress: Math.min(99, Math.max(task.progress || 0, serverProgress)),
                stage: stage ?? task.stage,
                jobId: metadata.jobId || task.jobId,
                sessionId: metadata.sessionId || task.sessionId,
                _ts: Date.now(),
            } : task));
        };

        const tickId = window.setInterval(() => {
            setBgTasks(prev => prev.map(task => {
                if (task.id !== taskId || task.status !== 'running') return task;
                const elapsed = Date.now() - (task._startedAt || Date.now());
                return {
                    ...task,
                    progress: Math.min(99, Math.max(
                        timedProgressPct(elapsed, task.expectedMs || expectedMs),
                        serverProgress,
                        task.progress || 0,
                    )),
                };
            }));
        }, 250);
        timersRef.current.set(taskId, tickId);

        Promise.resolve()
            .then(() => triggerFn(reportProgress))
            .then(result => {
                window.clearInterval(tickId);
                timersRef.current.delete(taskId);
                trackEvent('generation_complete', { tool: type, label, filename });
                finishTask(taskId, result);
            })
            .catch(error => {
                window.clearInterval(tickId);
                timersRef.current.delete(taskId);
                failTask(taskId, error);
            });

        return taskId;
    }, [failTask, finishTask]);

    const dismissTask = useCallback((taskId) => {
        retryFnsRef.current.delete(taskId);
        setBgTasks(prev => prev.filter(task => task.id !== taskId));
    }, []);

    const clearFinished = useCallback(() => {
        setBgTasks(prev => {
            prev.filter(task => task.status !== 'running').forEach(task => retryFnsRef.current.delete(task.id));
            return prev.filter(task => task.status === 'running');
        });
    }, []);

    const retryTask = useCallback((taskId) => {
        const retry = retryFnsRef.current.get(taskId);
        if (!retry) return false;
        dismissTask(taskId);
        addBgTask(retry.type, retry.label, retry.filename, retry.triggerFn, retry.options);
        return true;
    }, [addBgTask, dismissTask]);

    const canRetryTask = useCallback(taskId => retryFnsRef.current.has(taskId), []);

    useEffect(() => {
        try {
            window.sessionStorage.setItem(taskStorageKey(currentUserId), JSON.stringify(bgTasks));
        } catch {
            // The task tray still works when storage is unavailable.
        }
    }, [bgTasks, currentUserId]);

    useEffect(() => {
        bgTasks
            .filter(task => task.status === 'running' && task.jobId && !resumedJobsRef.current.has(task.jobId))
            .forEach(task => {
                resumedJobsRef.current.add(task.jobId);
                waitForJob(task.jobId, token, {
                    onProgress: job => setBgTasks(prev => prev.map(item => item.id === task.id ? {
                        ...item,
                        progress: Math.min(99, job.progressPct || item.progress || 1),
                        stage: job.stage || item.stage,
                        _ts: Date.now(),
                    } : item)),
                }).then(result => finishTask(task.id, result)).catch(error => failTask(task.id, error));
            });
    }, [bgTasks, failTask, finishTask, token]);

    useEffect(() => {
        const timers = timersRef.current;
        const pruneId = window.setInterval(() => {
            const now = Date.now();
            setBgTasks(prev => prev.filter(task => task.status === 'running' || now - (task._ts || 0) < RECENT_TASK_MS));
        }, 60000);
        return () => {
            window.clearInterval(pruneId);
            timers.forEach(timerId => window.clearInterval(timerId));
            timers.clear();
        };
    }, []);

    return React.createElement(
        BgTaskContext.Provider,
        { value: {
            bgTasks,
            addBgTask,
            dismissTask,
            clearFinished,
            retryTask,
            canRetryTask,
        } },
        children,
    );
}

// The provider and its colocated hook form one public context API.
// eslint-disable-next-line react-refresh/only-export-components
export function useBgTasks() {
    const context = useContext(BgTaskContext);
    if (!context) throw new Error('useBgTasks must be used within BgTaskProvider');
    return context;
}
