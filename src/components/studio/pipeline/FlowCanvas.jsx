import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    addEdge,
    useNodesState,
    useEdgesState,
    ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { I } from '../shared/StudioIcons';
import { API, apiFetch, forceDownload } from '../shared/helpers';
import PipelineNode from './PipelineNode';
import { createNode, createEdge, graphToLegacy, validateGraph, estimateGraphCredits, newNodeId } from './pipelineGraph';
import { NODE_CATEGORIES, allAddableTypes, getNodeDef } from './pipelineRegistry';
import { executeGraph } from './pipelineExecutor';

const nodeTypes = { pipelineNode: PipelineNode };

function FlowCanvasInner({
    initialGraph,
    flowName: initialName,
    workflowId,
    activeProject,
    user,
    currentToken,
    creditPricing,
    setError,
    setNotice,
    updateCreditsFromResponse,
    onBack,
}) {
    const [flowName, setFlowName] = useState(initialName || 'Untitled Flow');
    const [savedId, setSavedId] = useState(workflowId || null);
    const [uploadFile, setUploadFile] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const fileRef = useRef(null);
    const uploadNodeIdRef = useRef(null);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph?.nodes || []);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph?.edges || []);
    const [viewport, setViewport] = useState(initialGraph?.viewport || { x: 0, y: 0, zoom: 0.85 });

    const updateNodeData = useCallback((nodeId, patch) => {
        setNodes((nds) => nds.map((n) => (
            n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
        )));
    }, [setNodes]);

    const handleUpload = useCallback(async (file, nodeId) => {
        if (!file) return;
        const previewUrl = URL.createObjectURL(file);
        updateNodeData(nodeId, { previewUrl, status: 'running' });
        try {
            const fd = new FormData();
            fd.append('image', file);
            fd.append('projectId', String(activeProject?.id || 1));
            if (user?.id) fd.append('userId', String(user.id));
            const d = await apiFetch('/api/upload', { method: 'POST', body: fd }, currentToken);
            if (d.success) {
                setUploadFile({ filename: d.filename, originalName: file.name });
                updateNodeData(nodeId, {
                    filename: d.filename,
                    previewUrl: `${API}/uploads/${d.filename}`,
                    resultUrl: `${API}/uploads/${d.filename}`,
                    status: 'done',
                    error: null,
                });
                updateCreditsFromResponse?.(d);
            } else {
                throw new Error(d.error || 'Upload failed');
            }
        } catch (err) {
            updateNodeData(nodeId, { status: 'error', error: err.message });
            setError?.(err.message);
        }
    }, [activeProject?.id, currentToken, setError, updateCreditsFromResponse, updateNodeData, user?.id]);

    const runNode = useCallback(async (nodeId) => {
        const err = validateGraph(nodes, edges, uploadFile?.filename);
        if (err && nodes.find((n) => n.id === nodeId)?.data?.nodeType !== 'imageInput') {
            setError?.(err);
            return;
        }
        setIsRunning(true);
        setError?.('');
        try {
            await executeGraph(
                { nodes, edges },
                {
                    projectId: activeProject?.id || 1,
                    userId: user?.id,
                    token: currentToken,
                    uploadFilename: uploadFile?.filename,
                    onCredits: updateCreditsFromResponse,
                },
                {
                    nodeId,
                    createRunRecord: false,
                    flowName,
                    onNodeStatus: (id, status, payload) => {
                        if (status === 'done') {
                            updateNodeData(id, {
                                status: 'done',
                                filename: payload?.filename,
                                resultUrl: payload?.resultUrl,
                                previewUrl: payload?.resultUrl,
                                error: null,
                            });
                        } else if (status === 'error') {
                            updateNodeData(id, { status: 'error', error: payload?.error });
                        } else {
                            updateNodeData(id, { status: 'running', error: null });
                        }
                    },
                },
            );
        } catch (err) {
            setError?.(err.message);
        } finally {
            setIsRunning(false);
        }
    }, [nodes, edges, uploadFile, activeProject?.id, user?.id, currentToken, flowName, setError, updateCreditsFromResponse, updateNodeData]);

    const runAll = useCallback(async () => {
        const err = validateGraph(nodes, edges, uploadFile?.filename);
        if (err) {
            setError?.(err);
            return;
        }
        setIsRunning(true);
        setError?.('');
        setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: 'pending', error: null } })));
        try {
            const { results } = await executeGraph(
                { nodes, edges },
                {
                    projectId: activeProject?.id || 1,
                    userId: user?.id,
                    token: currentToken,
                    uploadFilename: uploadFile?.filename,
                    onCredits: updateCreditsFromResponse,
                },
                {
                    flowName,
                    onNodeStatus: (id, status, payload) => {
                        if (status === 'done') {
                            updateNodeData(id, {
                                status: 'done',
                                filename: payload?.filename,
                                resultUrl: payload?.resultUrl,
                                previewUrl: payload?.resultUrl,
                            });
                        } else if (status === 'error') {
                            updateNodeData(id, { status: 'error', error: payload?.error });
                        } else {
                            updateNodeData(id, { status: 'running' });
                        }
                    },
                },
            );
            const exportNode = nodes.find((n) => n.data.nodeType === 'export');
            const exportResult = exportNode ? results[exportNode.id] : null;
            if (exportResult?.resultUrl) {
                await forceDownload(null, exportResult.resultUrl);
            }
            setNotice?.('Pipeline completed successfully.');
        } catch (err) {
            setError?.(err.message);
        } finally {
            setIsRunning(false);
        }
    }, [nodes, edges, uploadFile, activeProject?.id, user?.id, currentToken, flowName, setError, setNotice, updateCreditsFromResponse, updateNodeData, setNodes]);

    const saveFlow = useCallback(async () => {
        const graph = {
            nodes,
            edges,
            viewport,
        };
        const legacy = graphToLegacy({ nodes, edges });
        try {
            if (savedId) {
                await apiFetch(`/api/workflows/${savedId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        name: flowName.trim(),
                        steps: legacy.steps,
                        settings: legacy.settings,
                        graph,
                    }),
                }, currentToken);
            } else {
                const d = await apiFetch('/api/workflows', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: flowName.trim() || 'Untitled Flow',
                        steps: legacy.steps,
                        settings: legacy.settings,
                        graph,
                    }),
                }, currentToken);
                if (d.workflowId) setSavedId(d.workflowId);
            }
            setNotice?.('Flow saved.');
        } catch (err) {
            setError?.(err.message || 'Failed to save flow.');
        }
    }, [nodes, edges, viewport, flowName, savedId, currentToken, setNotice, setError]);

    const onConnect = useCallback((params) => {
        setEdges((eds) => addEdge({ ...params, type: 'smoothstep' }, eds));
    }, [setEdges]);

    const addNode = useCallback((type) => {
        const def = getNodeDef(type);
        if (!def) return;
        const id = newNodeId(type);
        const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
        const newN = createNode(type, { x: maxX + 280, y: 120 });
        newN.id = id;
        setNodes((nds) => [...nds, newN]);
    }, [nodes, setNodes]);

    const enrichedNodes = useMemo(() => nodes.map((n) => ({
        ...n,
        data: {
            ...n.data,
            creditPricing,
            isRunning,
            onRun: () => runNode(n.id),
            onUpload: () => {
                uploadNodeIdRef.current = n.id;
                fileRef.current?.click();
            },
            onSettingChange: (key, val) => {
                updateNodeData(n.id, {
                    settings: { ...n.data.settings, [key]: val },
                });
            },
        },
    })), [nodes, creditPricing, isRunning, runNode, updateNodeData]);

    const totalCredits = estimateGraphCredits(nodes, creditPricing);

    return (
        <div className="st-flow-canvas">
            <div className="st-flow-topbar">
                <button type="button" className="st-flow-back" onClick={onBack}>
                    <I d="M15 19l-7-7 7-7" s={18} /> Flows
                </button>
                <input
                    className="st-flow-name-input"
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                    placeholder="Flow name"
                />
                <span className="st-flow-credits-est">{totalCredits} credits est.</span>
                <button type="button" className="st-flow-save-btn" onClick={saveFlow}>Save</button>
                <button type="button" className="st-flow-runall-btn" onClick={runAll} disabled={isRunning}>
                    {isRunning ? 'Running…' : 'Run All'}
                </button>
            </div>

            <div className="st-flow-canvas-area">
                <ReactFlow
                    nodes={enrichedNodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    defaultViewport={viewport}
                    onMoveEnd={(_, vp) => setViewport(vp)}
                    fitView
                    minZoom={0.3}
                    maxZoom={1.5}
                    deleteKeyCode={['Backspace', 'Delete']}
                >
                    <Background gap={20} size={1} color="#e2e8f0" />
                    <Controls showInteractive={false} />
                    <MiniMap pannable zoomable />
                </ReactFlow>
            </div>

            <div className="st-flow-toolbar">
                {Object.entries(NODE_CATEGORIES).map(([key, cat]) => (
                    <div key={key} className="st-flow-toolbar-group">
                        <span className="st-flow-toolbar-label">{cat.label}</span>
                        {cat.types.filter((t) => t !== 'imageInput' && t !== 'export').map((type) => {
                            const def = getNodeDef(type);
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    className="st-flow-toolbar-btn"
                                    title={def?.desc}
                                    onClick={() => addNode(type)}
                                >
                                    <I d={def?.icon} s={16} />
                                </button>
                            );
                        })}
                    </div>
                ))}
                <div className="st-flow-toolbar-group">
                    <span className="st-flow-toolbar-label">More</span>
                    {allAddableTypes().filter((t) => !Object.values(NODE_CATEGORIES).flatMap((c) => c.types).includes(t)).map((type) => {
                        const def = getNodeDef(type);
                        return (
                            <button key={type} type="button" className="st-flow-toolbar-btn" title={def?.label} onClick={() => addNode(type)}>
                                <I d={def?.icon} s={16} />
                            </button>
                        );
                    })}
                </div>
            </div>

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && uploadNodeIdRef.current) handleUpload(f, uploadNodeIdRef.current);
                    e.target.value = '';
                }}
            />
        </div>
    );
}

export default function FlowCanvas(props) {
    return (
        <ReactFlowProvider>
            <FlowCanvasInner {...props} />
        </ReactFlowProvider>
    );
}
