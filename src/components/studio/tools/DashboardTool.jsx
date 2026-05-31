import React, { useState, useRef } from 'react';
import { I } from '../shared/StudioIcons';
import { API } from '../shared/helpers';

const STEP_TYPES = [
    { type: 'upload', label: 'Upload', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', desc: 'Upload artwork' },
    { type: 'extract', label: 'Extract Design', icon: 'M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z', desc: 'AI pattern extraction' },
    { type: 'seamless', label: 'Make Seamless', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', desc: 'Seamless tiling' },
    { type: 'repeat', label: 'Repeat', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', desc: 'Repeat pattern grid' },
    { type: 'vectorize', label: 'Vectorize', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', desc: 'Convert to SVG' },
    { type: 'upscale', label: 'Upscale', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', desc: 'Enhance resolution' },
    { type: 'export', label: 'Export', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', desc: 'Export output' },
];

export default function DashboardTool(props) {
    const {
        uploaded, preview, activeProject, user, controls, setError, addBgTask, updateCreditsFromResponse,
        setUploads, tool, currentToken, state
    } = props;

    const [dashboardTab, setDashboardTab] = useState('run');
    const [savedProfiles, setSavedProfiles] = useState([]);
    const [pipelineSteps, setPipelineSteps] = useState([
        { id: 'step-upload', type: 'upload', settings: {}, status: 'idle' },
        { id: 'step-export', type: 'export', settings: { outputFormat: 'PNG' }, status: 'idle' },
    ]);
    const [pipelineRunning, setPipelineRunning] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [pipelineName, setPipelineName] = useState('');
    const [pipelineFile, setPipelineFile] = useState(null);
    const [pipelinePreview, setPipelinePreview] = useState(null);
    const pipelineFileRef = useRef(null);

    const estimatedCredits = pipelineSteps.filter(s => s.type !== 'upload' && s.type !== 'export').length * 50;

    const addPipelineStep = (type) => {
        const newStep = { id: `step-${Date.now()}`, type, settings: {}, status: 'idle' };
        setPipelineSteps(prev => {
            const exportIdx = prev.findIndex(s => s.type === 'export');
            if (exportIdx === -1) return [...prev, newStep];
            const copy = [...prev];
            copy.splice(exportIdx, 0, newStep);
            return copy;
        });
    };

    const removePipelineStep = (id) => {
        setPipelineSteps(prev => prev.filter(s => s.id !== id));
    };

    const updateStepSetting = (id, key, value) => {
        setPipelineSteps(prev => prev.map(s => s.id === id ? { ...s, settings: { ...s.settings, [key]: value } } : s));
    };

    const savePipelineProfile = async () => {
        if (!pipelineName.trim()) return;
        const profile = { id: Date.now().toString(), name: pipelineName, steps: pipelineSteps };
        setSavedProfiles(prev => [...prev, profile]);
        setPipelineName('');
    };

    const deleteProfile = (id) => {
        setSavedProfiles(prev => prev.filter(p => p.id !== id));
    };

    const runProfile = (profile) => {
        setPipelineSteps(profile.steps.map(s => ({ ...s, status: 'idle' })));
        setDashboardTab('run');
    };

    const loadProfile = (profile) => {
        setPipelineSteps(profile.steps.map(s => ({ ...s, status: 'idle' })));
        setPipelineName(profile.name);
        setDashboardTab('build');
    };

    const runPipeline = async () => {
        if (pipelineRunning || pipelineSteps.length === 0) return;
        setPipelineRunning(true);
        try {
            for (let i = 0; i < pipelineSteps.length; i++) {
                setPipelineSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'running' } : s));
                // Simulate step execution
                await new Promise(r => setTimeout(r, 1500));
                setPipelineSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' } : s));
            }
        } catch (err) {
            setError(err.message || 'Pipeline failed');
        } finally {
            setPipelineRunning(false);
        }
    };

    const handlePreUpload = (file, context) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        if (context === 'pipeline') {
            setPipelineFile({ file, url, originalName: file.name });
        } else {
            setUploads(prev => ({ ...prev, [tool]: { file, url } }));
        }
    };

    
    return (
        <>


                <div className="st-pipeline-studio">
                    <div className="st-pl-tabs">
                        <button className={`st-pl-tab ${dashboardTab === 'run' ? 'active' : ''}`} onClick={() => setDashboardTab('run')}>
                            <I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={18} /> My Workflows
                        </button>
                        <button className={`st-pl-tab ${dashboardTab === 'build' ? 'active' : ''}`} onClick={() => setDashboardTab('build')}>
                            <I d="M12 5v14M5 12h14" s={18} /> Workflow Builder
                        </button>
                    </div>

                    {/* Saved Profiles */}
                    {dashboardTab === 'run' && savedProfiles.length > 0 && (
                        <div className="st-pl-section" style={{ marginBottom: '1.25rem' }}>
                            <h2 className="st-pl-section-num">Saved Workflows</h2>
                            <div className="st-pl-templates">
                                {savedProfiles.map(profile => (
                                    <div
                                        key={profile.id}
                                        className="st-pl-template-card profile-card"
                                        onClick={() => loadProfile(profile)}
                                    >
                                        <div className="st-pl-template-icon"><I d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" s={22} /></div>
                                        <strong>{profile.name}</strong>
                                        <span>{profile.steps.length} steps configured</span>
                                        <div className="st-pl-profile-actions">
                                            <button onClick={(e) => { e.stopPropagation(); runProfile(profile); }} title="Run"><I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={14} /></button>
                                            <button onClick={(e) => { e.stopPropagation(); loadProfile(profile); }} title="Edit"><I d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" s={14} /></button>
                                            <button className="danger" onClick={(e) => { e.stopPropagation(); deleteProfile(profile.id); }} title="Delete"><I d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" s={14} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {dashboardTab === 'run' && savedProfiles.length === 0 && (
                        <div className="st-pl-section" style={{ marginBottom: '1.25rem', textAlign: 'center', padding: '3rem 1rem' }}>
                            <h2 style={{ color: '#344054', marginBottom: '0.5rem' }}>No workflows found</h2>
                            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Go to the Workflow Builder tab to create and save a custom pipeline!</p>
                        </div>
                    )}

                    {/* Section 1: Available Tools */}
                    {dashboardTab === 'build' && (
                        <div className="st-pl-section" style={{ marginBottom: '1.25rem' }}>
                            <h2 className="st-pl-section-num">Add Tools to Pipeline</h2>
                            <div className="st-pl-templates">
                                {STEP_TYPES.filter(t => t.type !== 'upload' && t.type !== 'export').map(toolDef => (
                                    <div
                                        key={toolDef.type}
                                        className="st-pl-template-card draggable"
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('stepType', toolDef.type);
                                        }}
                                        onClick={() => addPipelineStep(toolDef.type)}
                                    >
                                        <div className="st-pl-template-icon"><I d={toolDef.icon} s={22} /></div>
                                        <strong>{toolDef.label}</strong>
                                        <span>{toolDef.desc}</span>
                                        <div className="st-pl-drag-hint"><I d="M12 5v14M5 12h14" s={14} /> Add</div>
                                    </div>
                                ))}
                            </div>
                            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '1rem', textAlign: 'center' }}>
                                Click a tool or drag it into the builder below to insert it into your pipeline.
                            </p>
                        </div>
                    )}

                    {/* Section 2: Build Your Pipeline */}
                    <div className="st-pl-section">
                        <h2 className="st-pl-section-num">{dashboardTab === 'build' ? 'Build Your Pipeline' : 'Pipeline Configuration'}</h2>
                        <div
                            className={`st-pl-builder ${isDraggingOver && dashboardTab === 'build' ? 'drag-over' : ''}`}
                            onDragOver={dashboardTab === 'build' ? (e) => { e.preventDefault(); setIsDraggingOver(true); } : undefined}
                            onDragLeave={dashboardTab === 'build' ? () => setIsDraggingOver(false) : undefined}
                            onDrop={dashboardTab === 'build' ? (e) => {
                                e.preventDefault();
                                setIsDraggingOver(false);
                                const type = e.dataTransfer.getData('stepType');
                                if (type) addPipelineStep(type);
                            } : undefined}
                        >
                            {pipelineSteps.map((step, i) => {
                                const def = STEP_TYPES.find(d => d.type === step.type);
                                const isUploadStep = step.type === 'upload';
                                const uploadDone = isUploadStep && pipelineFile;
                                return (
                                    <React.Fragment key={step.id}>
                                        {i > 0 && <div className={`st-pl-connector ${step.status === 'done' || (i === 1 && uploadDone) ? 'done' : ''}`}><I d="M9 5l7 7-7 7" s={14} /></div>}
                                        <div
                                            className={`st-pl-step ${uploadDone ? 'done' : step.status}`}
                                            onClick={() => {
                                                if (isUploadStep) pipelineFileRef.current?.click();
                                                else if (step.resultUrl) setPipelinePreview(step.resultUrl);
                                            }}
                                        >
                                            <div className="st-pl-step-icon"><I d={def?.icon || ''} s={20} /></div>
                                            <div className="st-pl-step-label">{def?.label}</div>
                                            <div className="st-pl-step-desc">
                                                {isUploadStep && pipelineFile ? pipelineFile.originalName || 'Uploaded' : def?.desc}
                                                {step.type === 'repeat' && (
                                                    <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.gridSize || 3} onChange={e => updateStepSetting(step.id, 'gridSize', parseInt(e.target.value))}>
                                                        <option value="2">2x2 Grid</option>
                                                        <option value="3">3x3 Grid</option>
                                                        <option value="4">4x4 Grid</option>
                                                        <option value="6">6x6 Grid</option>
                                                    </select>
                                                )}
                                                {step.type === 'upscale' && (
                                                    <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.upscaleFactor || 'x4'} onChange={e => updateStepSetting(step.id, 'upscaleFactor', e.target.value)}>
                                                        <option value="x2">2x Upscale</option>
                                                        <option value="x4">4x Upscale</option>
                                                    </select>
                                                )}
                                                {step.type === 'export' && (
                                                    <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.outputFormat || 'PNG'} onChange={e => updateStepSetting(step.id, 'outputFormat', e.target.value)}>
                                                        <option value="PNG">PNG Output</option>
                                                        <option value="JPG">JPG Output</option>
                                                        <option value="TIFF">TIFF Output</option>
                                                    </select>
                                                )}
                                            </div>
                                            {(uploadDone || step.status === 'done') && <div className="st-pl-step-badge done"><I d="M5 13l4 4L19 7" s={12} /></div>}
                                            {step.status === 'running' && <div className="st-pl-step-badge running"><div className="st-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /></div>}
                                            {step.status === 'error' && <div className="st-pl-step-badge error"><I d="M6 18L18 6M6 6l12 12" s={12} /></div>}
                                            {!pipelineRunning && !isUploadStep && step.type !== 'export' && dashboardTab === 'build' && (
                                                <button className="st-pl-step-remove" onClick={(e) => { e.stopPropagation(); removePipelineStep(step.id); }}>×</button>
                                            )}
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                            {/* {!pipelineRunning && (
                <div className="st-pl-add-wrapper">
                  <button className="st-pl-add-btn" onClick={() => setShowAddMenu(!showAddMenu)}>
                    <I d="M12 5v14M5 12h14" s={16} /> Add Step
                  </button>
                  {showAddMenu && (
                    <div className="st-pl-add-menu">
                      {STEP_TYPES.filter(t => t.type !== 'upload' && t.type !== 'export').map(t => (
                        <button key={t.type} className="st-pl-add-item" onClick={() => { addPipelineStep(t.type); setShowAddMenu(false); }}>
                          <I d={t.icon} s={16} /> {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )} */}
                        </div>
                    </div>

                    {/* Section 3: Run Pipeline */}
                    <div className="st-pl-run-section">
                        {dashboardTab === 'build' ? (
                            <input
                                type="text"
                                className="st-pl-name-input"
                                value={pipelineName}
                                onChange={e => setPipelineName(e.target.value)}
                                placeholder="Name your pipeline..."
                            />
                        ) : <div style={{ flex: 1 }} />}
                        <div className="st-pl-run-area">
                            <div className="st-pl-credits">Estimated Credits: <strong>{estimatedCredits}</strong></div>
                            {dashboardTab === 'build' && (
                                <button className="st-pl-save-btn" onClick={savePipelineProfile} disabled={pipelineRunning || pipelineSteps.length <= 2}>
                                    <I d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" s={18} /> Save Profile
                                </button>
                            )}
                            <button className="st-pl-run-btn" disabled={pipelineRunning || pipelineSteps.length === 0} onClick={runPipeline}>
                                {pipelineRunning ? <><div className="st-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Running...</> : <><I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={18} /> Run Pipeline</>}
                            </button>
                        </div>
                    </div>

                    {/* Pipeline upload for first step */}
                    {pipelineSteps.length > 0 && pipelineSteps[0]?.type === 'upload' && !pipelineFile && (
                        <div className="st-pl-upload-prompt" onClick={() => pipelineFileRef.current?.click()}>
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={24} />
                            <strong>Upload your artwork to get started</strong>
                            <span>PNG, JPG up to 10MB</span>
                        </div>
                    )}
                    <input ref={pipelineFileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handlePreUpload(e.target.files[0], 'pipeline')} />
                </div>
            
        </>
    );
}
