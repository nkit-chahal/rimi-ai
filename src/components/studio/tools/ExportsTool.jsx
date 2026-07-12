import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from '../shared/StudioIcons';
import { API, apiFetch, forceDownload, jsonAuthHeaders, mediaUrl, cacheFileAccessToken } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import { createPortal } from 'react-dom';
import '../../../styles/tools/exports.css';
import OpenInQwenButton from '../shared/OpenInQwenButton';

export default function ExportsTool(props) {
    const { uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, creditPricing, currentToken, tool, onExportComplete, setTool, setQwenLaunch, setUploads } = props;

    const [exportsList, setExportsList] = useState([]);
    const [isLoadingExports, setIsLoadingExports] = useState(false);
    const [selectedExports, setSelectedExports] = useState(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [exportsFilter, setExportsFilter] = useState('all');
    const [exportsPage, setExportsPage] = useState(1);
    const [pipelineRuns, setPipelineRuns] = useState([]);
    const [versions, setVersions] = useState([]);
    const [shareLoading, setShareLoading] = useState(null);
    const [restoreLoading, setRestoreLoading] = useState(null);
    const isFreePlan = (user?.plan || 'Free Trial').toLowerCase().includes('free');

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const techPackCreditCost = creditPricing?.techPack || 2;
    const hasEnoughTechPackCredits = userRemainingCredits >= techPackCreditCost;

    const filteredExports = useMemo(() => {
        if (exportsFilter === 'all') return exportsList;
        return exportsList.filter(f => f.type === exportsFilter);
    }, [exportsList, exportsFilter]);

    const loadExports = useCallback(() => {
        setIsLoadingExports(true);
        const projectId = activeProject?.id || 1;
        const authHeaders = currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
        Promise.all([
            fetch(`${API}/api/exports?project_id=${projectId}`, { headers: authHeaders }).then(res => res.json()),
            fetch(`${API}/api/pipeline-runs?project_id=${projectId}`, { headers: authHeaders }).then(res => res.json())
        ])
            .then(([exportsData, runsData]) => {
                if (exportsData.success) {
                    exportsData.exports.forEach((file) => {
                        if (file.fileAccessToken) cacheFileAccessToken(file.imageUrl, file.fileAccessToken);
                        if (file.previewAccessToken) cacheFileAccessToken(file.previewUrl, file.previewAccessToken);
                        if (file.inputAccessToken && file.inputUrl) {
                            cacheFileAccessToken(file.inputUrl, file.inputAccessToken);
                        }
                    });
                    setExportsList(exportsData.exports);
                    setSelectedExports(new Set());
                    setExportsPage(1);
                }
                if (runsData.success) {
                    setPipelineRuns(runsData.runs);
                }
            })
            .catch(err => {
                console.error("Error loading exports or runs:", err);
                fetch(`${API}/api/exports?project_id=${activeProject?.id || 1}`, { headers: authHeaders })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            setExportsList(data.exports);
                            setSelectedExports(new Set());
                            setExportsPage(1);
                        }
                    });
            })
            .finally(() => setIsLoadingExports(false));
    }, [activeProject?.id, currentToken]);

    const loadVersions = useCallback(() => {
        if (!activeProject?.id || !currentToken) return;
        apiFetch(`/api/projects/${activeProject.id}/versions`, {}, currentToken)
            .then((data) => {
                if (data.success) setVersions(data.versions || []);
            })
            .catch(() => {});
    }, [activeProject?.id, currentToken]);

    useEffect(() => {
        if (tool === 'exports') {
            loadExports();
            loadVersions();
        }
    }, [tool, loadExports, loadVersions]);

    const shareExport = async (filename) => {
        setShareLoading(filename);
        try {
            const data = await apiFetch('/api/share-links', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: activeProject.id,
                    exportFilename: filename,
                    expiresDays: 14,
                }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Failed to create share link');
            await navigator.clipboard.writeText(data.shareUrl);
            setError('');
            window.alert('Share link copied to clipboard.');
        } catch (err) {
            setError(err.message || 'Could not create share link');
        } finally {
            setShareLoading(null);
        }
    };

    const restoreVersion = async (versionId) => {
        setRestoreLoading(versionId);
        try {
            const data = await apiFetch(`/api/projects/${activeProject.id}/versions/${versionId}/restore`, {
                method: 'POST',
                body: JSON.stringify({}),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Failed to restore version');
            loadVersions();
            loadExports();
        } catch (err) {
            setError(err.message || 'Could not restore version');
        } finally {
            setRestoreLoading(null);
        }
    };

    const toggleExportSelect = (id) => {
        setSelectedExports(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const selectAllExports = () => {
        const ids = filteredExports.map(f => f.id);
        if (ids.every(id => selectedExports.has(id))) {
            setSelectedExports(new Set());
        } else {
            setSelectedExports(new Set(ids));
        }
    };

    const deleteExports = async (filenames) => {
        if (!filenames.length) return;
        if (!window.confirm(`Delete ${filenames.length} file${filenames.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
        setIsDeleting(true);
        try {
            await fetch(`${API}/api/exports`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
                },
                body: JSON.stringify({ filenames }),
            });
            loadExports();
        } catch {
            setError('Failed to delete files.');
        } finally {
            setIsDeleting(false);
        }
    };

    const [techPackLoading, setTechPackLoading] = useState(null);
    const generateTechPack = async (filename) => {
        if (!hasEnoughTechPackCredits) {
            setError(`Insufficient credits. Tech pack generation needs ${techPackCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
        setTechPackLoading(filename);
        setError('');
        try {
            const res = await fetch(`${API}/api/tech-pack`, {
                method: 'POST',
                headers: jsonAuthHeaders(currentToken),
                body: JSON.stringify({
                    filename,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                updateCreditsFromResponse(d);
                // Trigger PDF download
                const link = document.createElement('a');
                link.href = `${API}${d.resultUrl}`;
                link.download = `techpack_${filename.replace(/\.[^.]+$/, '')}.pdf`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                throw new Error(d.error || 'Failed to generate tech pack');
            }
        } catch (e) {
            setError(e.message || 'Tech Pack generation failed');
        } finally {
            setTechPackLoading(null);
        }
    };

    // ===== PIPELINE STUDIO =====
    const STEP_TYPES = [
        { type: 'upload', label: 'Upload Artwork', desc: 'PNG, JPG up to 10MB', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', credits: 0 },
        { type: 'extract', label: 'Pattern Extraction', desc: 'AI cleans & extracts pattern elements', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', credits: creditPricing?.extract || 148 },
        { type: 'seamless', label: 'Seamless Fix', desc: 'Creates seamless, tileable pattern', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', credits: creditPricing?.seamless || 58 },
        { type: 'repeat', label: 'Repeat Set', desc: 'Generates repeat variations', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', credits: creditPricing?.repeat || 5 },
        { type: 'upscale', label: 'High Resolution', desc: 'Upscale to 600 DPI print quality', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', credits: creditPricing?.upscale || 23 },
        { type: 'vectorize', label: 'Vectorize', desc: 'Convert to scalable vector artwork', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', credits: creditPricing?.vectorize || 12 },
        { type: 'export', label: 'Export', desc: 'Choose formats & download', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', credits: 0 },
    ];

    const PIPELINE_TEMPLATES = [
        { id: 'extract', name: 'Pattern Extraction', desc: 'Extract patterns and clean artwork.', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', steps: ['upload', 'extract', 'export'] },
        { id: 'seamless', name: 'Make Seamless', desc: 'Remove seams and create tileable patterns.', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', steps: ['upload', 'seamless', 'export'] },
        { id: 'repeat', name: 'Repeat Set', desc: 'Generate half drop, brick, and more.', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', steps: ['upload', 'repeat', 'export'] },
        { id: 'upscale', name: 'Super Resolution', desc: 'Upscale for print with AI.', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', steps: ['upload', 'upscale', 'export'] },
        { id: 'vectorize', name: 'Vectorize', desc: 'Convert to scalable vector artwork.', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', steps: ['upload', 'vectorize', 'export'] },
        { id: 'full', name: 'Full Print Pipeline', desc: 'End-to-end workflow for print ready files.', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', steps: ['upload', 'extract', 'seamless', 'repeat', 'upscale', 'export'] },
    ];



    if (tool === 'exports') {
        const imageCount = exportsList.filter(f => f.type === 'image').length;
        const vectorCount = exportsList.filter(f => f.type === 'vector').length;

        const formatTimestamp = (ts) => {
            if (!ts) return '';
            const date = new Date(ts * 1000);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');

            let hours = date.getHours();
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            const hh = String(hours).padStart(2, '0');

            return `${yyyy}-${mm}-${dd} ${hh}:${minutes} ${ampm}`;
        };

        const getToolInfo = (filename) => {
            if (filename.startsWith('repeat_')) {
                const gridMatch = filename.match(/repeat_(\d+x\d+)_/);
                const grid = gridMatch ? gridMatch[1] : '3x3';
                return {
                    label: 'Repeat Set',
                    badgeClass: 'repeat',
                    icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
                    params: [`Grid: ${grid}`, 'DPI: 300', 'Tile Repeat']
                };
            }
            if (filename.startsWith('vec_')) {
                return {
                    label: 'Vectorize',
                    badgeClass: 'vectorize',
                    icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
                    params: ['Colors: 32', 'Engine: AI Local', 'Vector SVG']
                };
            }
            if (filename.startsWith('upscale_')) {
                return {
                    label: 'Upscale',
                    badgeClass: 'upscale',
                    icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
                    params: ['Factor: x4', 'DPI: 600', 'AI Upscale']
                };
            }
            if (filename.startsWith('seamless_')) {
                return {
                    label: 'Seamless Fix',
                    badgeClass: 'seamless',
                    icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
                    params: ['Seam Assess', 'Geometric Patch', 'Tileable']
                };
            }
            if (filename.startsWith('mockup_')) {
                return {
                    label: 'Mappings',
                    badgeClass: 'mappings',
                    icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
                    params: ['Product Mockup', '3D Map', 'Preview']
                };
            }
            if (filename.startsWith('recolor_')) {
                return {
                    label: 'Colorway',
                    badgeClass: 'generic',
                    icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
                    params: ['Palette Swap', 'Color Map', 'Recolor']
                };
            }
            if (filename.startsWith('techpack_')) {
                return {
                    label: 'Tech Pack',
                    badgeClass: 'generic',
                    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
                    params: ['PDF', 'Color Palette', 'Specs']
                };
            }
            return {
                label: 'AI Export',
                badgeClass: 'generic',
                icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
                params: ['Auto-save', 'History']
            };
        };

        const resolveAssetUrl = (url) => mediaUrl(url);

        const renderOriginalImage = (src) => {
            if (src) {
                return <MediaImg src={src} alt="Original Input" className="st-export-log-image" loading="lazy" token={currentToken} />;
            }
            return (
                <div className="st-export-log-placeholder">
                    <svg className="st-export-placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
                        <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5" />
                        <path d="M21 15l-5-5L5 21" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Original Input</span>
                </div>
            );
        };

        const renderPipelineStepper = (run) => {
            return (
                <div className="st-export-stepper">
                    <div className="st-stepper-title">Pipeline: {run.name || 'Custom Workflow'}</div>
                    <div className="st-stepper-flow">
                        {run.steps.map((stepType, idx) => {
                            const stepDef = STEP_TYPES.find(s => s.type === stepType);
                            const isLast = idx === run.steps.length - 1;
                            return (
                                <React.Fragment key={idx}>
                                    <div className="st-stepper-node" title={stepDef?.desc || stepType}>
                                        <div className="st-node-icon">
                                            <I d={stepDef?.icon || "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"} s={12} />
                                        </div>
                                        <span className="st-node-label">{stepDef?.label || stepType}</span>
                                    </div>
                                    {!isLast && <div className="st-stepper-connector" />}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            );
        };

        const renderSingleToolStepper = (filename) => {
            const info = getToolInfo(filename);
            return (
                <div className="st-export-single-tool">
                    <div className="st-stepper-title">Operation: {info.label}</div>
                    <div className="st-tool-params">
                        <div className={`st-tool-badge-pill ${info.badgeClass}`}>
                            <I d={info.icon} s={12} />
                            <span>{info.label}</span>
                        </div>
                        <div className="st-params-divider" />
                        <div className="st-params-list">
                            {info.params.map((p, idx) => (
                                <span key={idx} className="st-param-pill">{p}</span>
                            ))}
                        </div>
                    </div>
                </div>
            );
        };

        // Pagination calculation
        const itemsPerPage = 9;
        const indexOfLastItem = exportsPage * itemsPerPage;
        const indexOfFirstItem = indexOfLastItem - itemsPerPage;
        const currentItems = filteredExports.slice(indexOfFirstItem, indexOfLastItem);
        const totalPages = Math.ceil(filteredExports.length / itemsPerPage);

        const pageNumbers = [];
        for (let i = 1; i <= totalPages; i++) {
            pageNumbers.push(i);
        }

        return (
            <div className="st-inspire-canvas full-width">
                {versions.length > 0 && (
                    <div className="st-versions-panel">
                        <div className="st-stepper-title">Version history</div>
                        <div className="st-versions-grid">
                            {versions.slice(0, 12).map((version) => {
                                const thumb = mediaUrl(version.imageUrl);
                                return (
                                    <button
                                        key={version.id}
                                        type="button"
                                        className={`st-version-card ${version.isSelected ? 'selected' : ''}`}
                                        onClick={() => restoreVersion(version.id)}
                                        disabled={restoreLoading === version.id}
                                    >
                                        <MediaImg src={thumb} alt={version.name} loading="lazy" token={currentToken} />
                                        <div className="st-version-meta">
                                            {restoreLoading === version.id ? 'Restoring…' : version.name}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                {isFreePlan && (
                    <div className="st-watermark-badge" style={{ marginBottom: '1rem' }}>
                        Free plan downloads include a RIMI AI watermark. Upgrade for clean exports.
                    </div>
                )}
                {isLoadingExports ? (
                    <div className="st-loading"><div className="st-spinner" /><span>Loading history...</span></div>
                ) : exportsList.length > 0 ? (
                    <>
                        <div className="st-exports-toolbar">
                            <div className="st-exports-toolbar-left">
                                <label className="st-exports-select-all">
                                    <input
                                        type="checkbox"
                                        checked={filteredExports.length > 0 && filteredExports.every(f => selectedExports.has(f.id))}
                                        onChange={selectAllExports}
                                    />
                                    <span>{selectedExports.size > 0 ? `${selectedExports.size} selected` : 'Select all'}</span>
                                </label>
                                {selectedExports.size > 0 && (
                                    <button
                                        className="st-exports-delete-btn"
                                        onClick={() => deleteExports([...selectedExports])}
                                        disabled={isDeleting}
                                    >
                                        <I d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" s={14} />
                                        {isDeleting ? 'Deleting...' : `Delete ${selectedExports.size}`}
                                    </button>
                                )}
                            </div>
                            <select className="st-exports-filter" value={exportsFilter} onChange={(e) => { setExportsFilter(e.target.value); setExportsPage(1); }}>
                                <option value="all">All Files ({exportsList.length})</option>
                                <option value="image">Images ({imageCount})</option>
                                <option value="vector">Vectors ({vectorCount})</option>
                            </select>
                        </div>
                        {currentItems.length > 0 ? (
                            <div className="st-export-log-list">
                                {currentItems.map((file) => {
                                    const fullUrl = mediaUrl(file.imageUrl);
                                    const previewSrc = mediaUrl(file.previewUrl || file.imageUrl);
                                    const isSelected = selectedExports.has(file.id);

                                    // Match with a pipeline run
                                    const matchedRun = pipelineRuns.find(run => {
                                        if (!run.results) return false;
                                        return run.results.some(res => res.resultUrl && (res.resultUrl.endsWith(file.id) || res.resultUrl === file.imageUrl));
                                    });

                                    // Resolve original image URL
                                    const runInputUrl = matchedRun?.results?.find(res => res.type === 'upload')?.resultUrl;
                                    const originalSrc = resolveAssetUrl(file.inputUrl || runInputUrl);

                                    return (
                                        <div key={file.id} className={`st-export-log-card ${isSelected ? 'selected' : ''}`}>
                                            {/* Header metadata bar */}
                                            <div className="st-export-log-header">
                                                <div className="st-export-log-header-left">
                                                    <div className="st-export-check" onClick={() => toggleExportSelect(file.id)}>
                                                        <input type="checkbox" checked={isSelected} readOnly />
                                                    </div>
                                                    <span className="st-export-log-id" title={file.id}>{file.id}</span>
                                                </div>
                                                <div className="st-export-log-header-right">
                                                    <span className="st-export-timestamp">{formatTimestamp(file.timestamp)}</span>
                                                </div>
                                            </div>

                                            {/* Split panel contents */}
                                            <div className="st-export-log-body">
                                                {/* Original Input image on the left */}
                                                <div className="st-export-log-panel left">
                                                    <div className="st-panel-tag">Original Input</div>
                                                    <div className="st-panel-image-container">
                                                        {renderOriginalImage(originalSrc)}
                                                    </div>
                                                </div>

                                                {/* Pipeline/tool step in the center */}
                                                <div className="st-export-log-panel center">
                                                    <div className="st-panel-connection-line-bg" />
                                                    <div className="st-panel-connection-content">
                                                        {matchedRun ? renderPipelineStepper(matchedRun) : renderSingleToolStepper(file.id)}
                                                    </div>
                                                </div>

                                                {/* Final Output image on the right */}
                                                <div className="st-export-log-panel right">
                                                    <div className="st-panel-tag">Final Output</div>
                                                    <div className="st-panel-image-container">
                                                        <MediaImg src={previewSrc} alt="Final Output" className="st-export-log-image" loading="lazy" token={currentToken} />
                                                        <div className="st-export-image-hover">
                                                            <a href={fullUrl} onClick={(e) => { forceDownload(e, fullUrl, file.id, currentToken); onExportComplete?.({ filename: file.id, format: file.format, type: file.type }); }} className="st-export-hover-btn dl" title="Download">
                                                                <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} />
                                                                <span>Download</span>
                                                            </a>
                                                        </div>
                                                    </div>
                                                    <div className="st-export-meta-row">
                                                        <span className={`st-export-badge ${file.format.toLowerCase()}`}>{file.format}</span>
                                                        <span className="st-export-size">{file.size}</span>
                                                        <button
                                                            className="st-export-techpack-btn"
                                                            title="Copy public share link"
                                                            onClick={() => shareExport(file.id)}
                                                            disabled={shareLoading === file.id}
                                                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', transition: 'all 0.2s' }}
                                                        >
                                                            <I d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" s={13} />
                                                            {shareLoading === file.id ? 'Sharing…' : 'Share'}
                                                        </button>
                                                        {file.type === 'image' && (
                                                            <OpenInQwenButton
                                                                sourceFilename={file.id}
                                                                sourceUrl={file.imageUrl || previewSrc}
                                                                projectId={activeProject?.id}
                                                                userId={user?.id}
                                                                currentToken={currentToken}
                                                                setTool={setTool}
                                                                setQwenLaunch={setQwenLaunch}
                                                                setUploads={setUploads}
                                                                setError={setError}
                                                                className="st-export-techpack-btn"
                                                                label="Qwen Studio"
                                                            />
                                                        )}
                                                        {file.type === 'image' && (
                                                            <button
                                                                className="st-export-techpack-btn"
                                                                title="Download Tech Pack PDF"
                                                                onClick={() => generateTechPack(file.id)}
                                                                disabled={techPackLoading === file.id}
                                                                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', transition: 'all 0.2s' }}
                                                            >
                                                                <I d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" s={13} />
                                                                {techPackLoading === file.id ? 'Generating...' : 'Tech Pack'}
                                                            </button>
                                                        )}
                                                        <button
                                                            className="st-export-trash-btn"
                                                            title="Delete"
                                                            onClick={() => deleteExports([file.id])}
                                                            disabled={isDeleting}
                                                        >
                                                            <I d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" s={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="st-empty-canvas"><span className="st-empty-icon"><I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={32} /></span><p>No {exportsFilter === 'vector' ? 'vector' : 'image'} files found.</p></div>
                        )}

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="st-pagination">
                                <button
                                    className="st-pagination-btn prev"
                                    onClick={() => setExportsPage(prev => Math.max(prev - 1, 1))}
                                    disabled={exportsPage === 1}
                                >
                                    <I d="M15 19l-7-7 7-7" s={14} />
                                    <span>Prev</span>
                                </button>

                                <div className="st-pagination-numbers">
                                    {pageNumbers.map(number => (
                                        <button
                                            key={number}
                                            className={`st-pagination-number ${exportsPage === number ? 'active' : ''}`}
                                            onClick={() => setExportsPage(number)}
                                        >
                                            {number}
                                        </button>
                                    ))}
                                </div>

                                <button
                                    className="st-pagination-btn next"
                                    onClick={() => setExportsPage(prev => Math.min(prev + 1, totalPages))}
                                    disabled={exportsPage === totalPages}
                                >
                                    <span>Next</span>
                                    <I d="M9 5l7 7-7 7" s={14} />
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="st-empty-canvas"><span className="st-empty-icon"><I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={32} /></span><p>No history yet for this project.</p></div>
                )}
            </div>
        );
    }

}
