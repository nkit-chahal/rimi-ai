import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../shared/helpers';

const AUTOSAVE_MS = 2000;

export function useQwenSession({
    activeProject,
    user,
    currentToken,
    layersList,
    canvasWidth = 1024,
    canvasHeight = 1024,
    uploaded,
    qwenLaunch,
    clearQwenLaunch,
    onSessionLoaded,
}) {
    const [sessionId, setSessionId] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [versions, setVersions] = useState([]);
    const [sessionsOpen, setSessionsOpen] = useState(false);
    const autosaveTimer = useRef(null);
    const skipNextAutosave = useRef(false);

    const buildDocument = useCallback(() => ({
        layers: layersList.map((layer) => ({
            local_id: layer.id,
            id: layer.id,
            name: layer.name,
            filename: layer.filename,
            url: layer.url,
            x: layer.x ?? 0,
            y: layer.y ?? 0,
            scaleX: layer.scaleX ?? 1,
            scaleY: layer.scaleY ?? 1,
            angle: layer.angle ?? 0,
            flipX: layer.flipX ?? false,
            flipY: layer.flipY ?? false,
            opacity: layer.opacity ?? 1,
            visible: layer.visible !== false,
            locked: layer.locked ?? false,
            parent_local_id: layer.parentId ?? null,
        })),
        canvas: { width: canvasWidth, height: canvasHeight },
    }), [layersList, canvasWidth, canvasHeight]);

    const refreshSessions = useCallback(async () => {
        if (!activeProject?.id || !currentToken) return;
        try {
            const data = await apiFetch(`/api/qwen-sessions?projectId=${activeProject.id}`, {}, currentToken);
            if (data.success) setSessions(data.sessions || []);
        } catch (e) {
            console.error('Failed to load Qwen sessions', e);
        }
    }, [activeProject?.id, currentToken]);

    const loadSession = useCallback(async (id) => {
        if (!id || !currentToken) return null;
        try {
            const data = await apiFetch(`/api/qwen-sessions/${id}`, {}, currentToken);
            if (data.success) {
                setSessionId(id);
                setVersions(data.session?.versions || []);
                onSessionLoaded?.(data.session);
                return data.session;
            }
        } catch (e) {
            console.error('Failed to load session', e);
        }
        return null;
    }, [currentToken, onSessionLoaded]);

    const createSession = useCallback(async (sourceFilename) => {
        if (!activeProject?.id || !currentToken) return null;
        try {
            const data = await apiFetch('/api/qwen-sessions', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: activeProject.id,
                    userId: user?.id,
                    sourceFilename: sourceFilename || uploaded?.filename,
                    name: `Qwen Studio — ${sourceFilename || uploaded?.originalName || 'session'}`,
                    document: { layers: [], canvas: { width: canvasWidth, height: canvasHeight } },
                }),
            }, currentToken);
            if (data.success) {
                setSessionId(data.session.id);
                await refreshSessions();
                return data.session;
            }
        } catch (e) {
            console.error('Failed to create Qwen session', e);
        }
        return null;
    }, [activeProject?.id, currentToken, user?.id, uploaded, canvasWidth, canvasHeight, refreshSessions]);

    const autosaveSession = useCallback(async () => {
        if (!sessionId || !currentToken || skipNextAutosave.current) return;
        try {
            await apiFetch(`/api/qwen-sessions/${sessionId}`, {
                method: 'PATCH',
                body: JSON.stringify({ document: buildDocument() }),
            }, currentToken);
        } catch (e) {
            console.error('Autosave failed', e);
        }
    }, [sessionId, currentToken, buildDocument]);

    const revertLayerVersion = useCallback(async (versionId, layerLocalId) => {
        if (!sessionId || !currentToken) return null;
        const data = await apiFetch(`/api/qwen-sessions/${sessionId}/revert`, {
            method: 'POST',
            body: JSON.stringify({ versionId, layerLocalId }),
        }, currentToken);
        if (data.success) {
            skipNextAutosave.current = true;
            onSessionLoaded?.(data.session);
            window.setTimeout(() => { skipNextAutosave.current = false; }, 500);
            return data;
        }
        return null;
    }, [sessionId, currentToken, onSessionLoaded]);

    const semanticSelect = useCallback(async (query) => {
        if (!sessionId || !currentToken) return [];
        const data = await apiFetch(`/api/qwen-sessions/${sessionId}/semantic-select`, {
            method: 'POST',
            body: JSON.stringify({ query }),
        }, currentToken);
        return data.matches || [];
    }, [sessionId, currentToken]);

    const exportSession = useCallback(async (format = 'png') => {
        if (!sessionId || !currentToken) return null;
        const data = await apiFetch(`/api/qwen-sessions/${sessionId}/export`, {
            method: 'POST',
            body: JSON.stringify({ format, document: buildDocument() }),
        }, currentToken);
        return data;
    }, [sessionId, currentToken, buildDocument]);

    useEffect(() => {
        refreshSessions();
    }, [refreshSessions]);

    useEffect(() => {
        if (!qwenLaunch?.sessionId) return;
        loadSession(qwenLaunch.sessionId);
        clearQwenLaunch?.();
    }, [qwenLaunch, loadSession, clearQwenLaunch]);

    useEffect(() => {
        if (!sessionId || layersList.length === 0) return undefined;
        if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = window.setTimeout(() => {
            autosaveSession();
        }, AUTOSAVE_MS);
        return () => {
            if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
        };
    }, [sessionId, layersList, autosaveSession]);

    return {
        sessionId,
        setSessionId,
        sessions,
        versions,
        sessionsOpen,
        setSessionsOpen,
        refreshSessions,
        loadSession,
        createSession,
        revertLayerVersion,
        semanticSelect,
        exportSession,
        buildDocument,
    };
}
