import { useCallback, useRef, useState } from 'react';

const MAX_HISTORY = 50;

export function useLayerHistory() {
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const isApplying = useRef(false);

    const snapshot = useCallback((layersList, selectedLayerId) => ({
        layersList: JSON.parse(JSON.stringify(layersList)),
        selectedLayerId,
        ts: Date.now(),
    }), []);

    const pushHistory = useCallback((layersList, selectedLayerId) => {
        if (isApplying.current) return;
        setUndoStack((prev) => [...prev.slice(-(MAX_HISTORY - 1)), snapshot(layersList, selectedLayerId)]);
        setRedoStack([]);
    }, [snapshot]);

    const undo = useCallback((layersList, selectedLayerId, applyState) => {
        if (!undoStack.length) return null;
        const prev = undoStack[undoStack.length - 1];
        setRedoStack((r) => [...r, snapshot(layersList, selectedLayerId)]);
        setUndoStack((u) => u.slice(0, -1));
        isApplying.current = true;
        applyState(prev);
        window.setTimeout(() => { isApplying.current = false; }, 0);
        return prev;
    }, [undoStack, snapshot]);

    const redo = useCallback((layersList, selectedLayerId, applyState) => {
        if (!redoStack.length) return null;
        const next = redoStack[redoStack.length - 1];
        setUndoStack((u) => [...u, snapshot(layersList, selectedLayerId)]);
        setRedoStack((r) => r.slice(0, -1));
        isApplying.current = true;
        applyState(next);
        window.setTimeout(() => { isApplying.current = false; }, 0);
        return next;
    }, [redoStack, snapshot]);

    const canUndo = undoStack.length > 0;
    const canRedo = redoStack.length > 0;

    return { pushHistory, undo, redo, canUndo, canRedo };
}
