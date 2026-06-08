import React, { useState, useEffect, useCallback } from 'react';
import FlowsHome from '../pipeline/FlowsHome';
import FlowCanvas from '../pipeline/FlowCanvas';
import { createEmptyGraph, graphFromWorkflow } from '../pipeline/pipelineGraph';
import { templateToGraph } from '../pipeline/pipelineTemplates';
import { apiFetch } from '../shared/helpers';

export default function DashboardTool(props) {
    const {
        activeProject,
        user,
        setError,
        setNotice,
        updateCreditsFromResponse,
        creditPricing,
        currentToken,
        onEditorOpenChange,
    } = props;

    const [view, setView] = useState('home');
    const [workflows, setWorkflows] = useState([]);
    const [runs, setRuns] = useState([]);
    const [editorState, setEditorState] = useState(null);

    const loadData = useCallback(async () => {
        if (!currentToken) return;
        try {
            const [wf, pr] = await Promise.all([
                apiFetch('/api/workflows', {}, currentToken),
                apiFetch(`/api/pipeline-runs?project_id=${activeProject?.id || 1}`, {}, currentToken),
            ]);
            if (wf.success) setWorkflows(wf.workflows || []);
            if (pr.success) setRuns(pr.runs || []);
        } catch {
            /* non-fatal */
        }
    }, [activeProject?.id, currentToken]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        onEditorOpenChange?.(view === 'editor');
    }, [view, onEditorOpenChange]);

    const openEditor = (graph, name, workflowId = null) => {
        setEditorState({ graph, name, workflowId });
        setView('editor');
        setError?.('');
    };

    const handleNewFlow = () => {
        openEditor(createEmptyGraph(), 'Untitled Flow');
    };

    const handleOpenTemplate = (tmpl) => {
        openEditor(templateToGraph(tmpl), tmpl.name);
    };

    const handleOpenWorkflow = (item) => {
        openEditor(
            graphFromWorkflow({ graph: item.graph, steps: item.steps, settings: item.settings }),
            item.name,
            item.workflowId,
        );
    };

    const handleDuplicateWorkflow = async (item) => {
        openEditor(
            graphFromWorkflow({ graph: item.graph, steps: item.steps, settings: item.settings }),
            `${item.name} (copy)`,
        );
    };

    const handleDeleteWorkflow = async (id) => {
        if (!window.confirm('Delete this flow?')) return;
        try {
            await apiFetch(`/api/workflows/${id}`, { method: 'DELETE' }, currentToken);
            setWorkflows((prev) => prev.filter((w) => w.id !== id));
            setNotice?.('Flow deleted.');
        } catch (err) {
            setError?.(err.message || 'Delete failed.');
        }
    };

    const handleBack = () => {
        setView('home');
        setEditorState(null);
        loadData();
    };

    if (view === 'editor' && editorState) {
        return (
            <FlowCanvas
                initialGraph={editorState.graph}
                flowName={editorState.name}
                workflowId={editorState.workflowId}
                activeProject={activeProject}
                user={user}
                currentToken={currentToken}
                creditPricing={creditPricing}
                setError={setError}
                setNotice={setNotice}
                updateCreditsFromResponse={updateCreditsFromResponse}
                onBack={handleBack}
            />
        );
    }

    return (
        <FlowsHome
            workflows={workflows}
            runs={runs}
            onNewFlow={handleNewFlow}
            onOpenTemplate={handleOpenTemplate}
            onOpenWorkflow={handleOpenWorkflow}
            onDuplicateWorkflow={handleDuplicateWorkflow}
            onDeleteWorkflow={handleDeleteWorkflow}
        />
    );
}
