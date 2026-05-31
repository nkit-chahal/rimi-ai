import React, { useState, useEffect } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function ExportsTool({ activeProject, currentToken }) {
    const [exportsList, setExportsList] = useState([]);
    const [isLoadingExports, setIsLoadingExports] = useState(false);
    const [exportsFilter, setExportsFilter] = useState('all');
    const [exportsPage, setExportsPage] = useState(1);
    const [selectedExports, setSelectedExports] = useState(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [techPackLoading, setTechPackLoading] = useState(null);

    useEffect(() => {
        if (!activeProject?.id) return;
        setIsLoadingExports(true);
        fetch(`${API}/api/exports?projectId=${activeProject.id}`)
            .then(r => r.json())
            .then(d => { if (d.success) setExportsList(d.exports || []); })
            .catch(() => {})
            .finally(() => setIsLoadingExports(false));
    }, [activeProject?.id]);

    const imageCount = exportsList.filter(f => f.type === 'image').length;
    const vectorCount = exportsList.filter(f => f.type === 'vector').length;

    const filteredExports = exportsFilter === 'all' ? exportsList : exportsList.filter(f => f.type === exportsFilter);

    const itemsPerPage = 9;
    const indexOfLastItem = exportsPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredExports.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredExports.length / itemsPerPage);
    const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

    const toggleExportSelect = (id) => {
        setSelectedExports(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const selectAllExports = () => {
        if (filteredExports.every(f => selectedExports.has(f.id))) {
            setSelectedExports(new Set());
        } else {
            setSelectedExports(new Set(filteredExports.map(f => f.id)));
        }
    };

    const deleteExports = async (ids) => {
        if (!window.confirm(`Delete ${ids.length} export(s)?`)) return;
        setIsDeleting(true);
        try {
            await fetch(`${API}/api/exports/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, projectId: activeProject.id }),
            });
            setExportsList(prev => prev.filter(f => !ids.includes(f.id)));
            setSelectedExports(new Set());
        } catch (e) { console.error(e); }
        finally { setIsDeleting(false); }
    };

    const generateTechPack = async (fileId) => {
        setTechPackLoading(fileId);
        try {
            const res = await fetch(`${API}/api/generate-techpack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: fileId, projectId: activeProject.id }),
            });
            const d = await res.json();
            if (d.success && d.pdfUrl) {
                const link = document.createElement('a');
                link.href = `${API}${d.pdfUrl}`;
                link.download = `techpack_${fileId}.pdf`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        } catch (e) { console.error(e); }
        finally { setTechPackLoading(null); }
    };

    const formatTimestamp = (ts) => {
        if (!ts) return '';
        const date = new Date(ts * 1000);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        let hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${yyyy}-${mm}-${dd} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    };

    const getToolInfo = (filename) => {
        if (filename.startsWith('repeat_')) return { label: 'Repeat Set', badgeClass: 'repeat', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', params: ['Grid', 'DPI: 300', 'Tile Repeat'] };
        if (filename.startsWith('vec_')) return { label: 'Vectorize', badgeClass: 'vectorize', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', params: ['Colors: 32', 'Engine: AI', 'SVG'] };
        if (filename.startsWith('upscale_')) return { label: 'Upscale', badgeClass: 'upscale', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', params: ['Factor: x4', 'DPI: 600', 'AI Upscale'] };
        if (filename.startsWith('seamless_')) return { label: 'Seamless Fix', badgeClass: 'seamless', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', params: ['Seam Assess', 'Patch', 'Tileable'] };
        if (filename.startsWith('mockup_')) return { label: 'Mappings', badgeClass: 'mappings', icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z', params: ['Mockup', '3D Map'] };
        if (filename.startsWith('recolor_')) return { label: 'Colorway', badgeClass: 'generic', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', params: ['Palette Swap', 'Recolor'] };
        if (filename.startsWith('techpack_')) return { label: 'Tech Pack', badgeClass: 'generic', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', params: ['PDF', 'Specs'] };
        return { label: 'AI Export', badgeClass: 'generic', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', params: ['Auto-save'] };
    };

    return (
        <div className="st-inspire-canvas full-width">
            {isLoadingExports ? (
                <div className="st-loading"><div className="st-spinner" /><span>Loading exports...</span></div>
            ) : exportsList.length > 0 ? (
                <>
                    <div className="st-exports-toolbar">
                        <div className="st-exports-toolbar-left">
                            <label className="st-exports-select-all">
                                <input type="checkbox" checked={filteredExports.length > 0 && filteredExports.every(f => selectedExports.has(f.id))} onChange={selectAllExports} />
                                <span>{selectedExports.size > 0 ? `${selectedExports.size} selected` : 'Select all'}</span>
                            </label>
                            {selectedExports.size > 0 && (
                                <button className="st-exports-delete-btn" onClick={() => deleteExports([...selectedExports])} disabled={isDeleting}>
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
                                const fullUrl = file.imageUrl.startsWith('http') ? file.imageUrl : `${API}${file.imageUrl}`;
                                const previewSrc = (file.previewUrl || file.imageUrl).startsWith('http')
                                    ? (file.previewUrl || file.imageUrl)
                                    : `${API}${file.previewUrl || file.imageUrl}`;
                                const isSelected = selectedExports.has(file.id);
                                const info = getToolInfo(file.id);

                                return (
                                    <div key={file.id} className={`st-export-log-card ${isSelected ? 'selected' : ''}`}>
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
                                        <div className="st-export-log-body">
                                            <div className="st-export-log-panel left">
                                                <div className="st-panel-tag">Original Input</div>
                                                <div className="st-panel-image-container">
                                                    <div className="st-export-log-placeholder">
                                                        <svg className="st-export-placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
                                                            <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5" />
                                                            <path d="M21 15l-5-5L5 21" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                        <span>Original Input</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="st-export-log-panel center">
                                                <div className="st-panel-connection-line-bg" />
                                                <div className="st-panel-connection-content">
                                                    <div className="st-export-single-tool">
                                                        <div className="st-stepper-title">Operation: {info.label}</div>
                                                        <div className="st-tool-params">
                                                            <div className={`st-tool-badge-pill ${info.badgeClass}`}>
                                                                <I d={info.icon} s={12} /><span>{info.label}</span>
                                                            </div>
                                                            <div className="st-params-divider" />
                                                            <div className="st-params-list">
                                                                {info.params.map((p, idx) => <span key={idx} className="st-param-pill">{p}</span>)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="st-export-log-panel right">
                                                <div className="st-panel-tag">Final Output</div>
                                                <div className="st-panel-image-container">
                                                    <img src={previewSrc} alt="Final Output" className="st-export-log-image" loading="lazy" />
                                                    <div className="st-export-image-hover">
                                                        <a href={fullUrl} onClick={(e) => forceDownload(e, fullUrl)} className="st-export-hover-btn dl" title="Download">
                                                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} /><span>Download</span>
                                                        </a>
                                                    </div>
                                                </div>
                                                <div className="st-export-meta-row">
                                                    <span className={`st-export-badge ${file.format.toLowerCase()}`}>{file.format}</span>
                                                    <span className="st-export-size">{file.size}</span>
                                                    {file.type === 'image' && (
                                                        <button className="st-export-techpack-btn" title="Download Tech Pack PDF" onClick={() => generateTechPack(file.id)} disabled={techPackLoading === file.id}
                                                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', transition: 'all 0.2s' }}>
                                                            <I d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" s={13} />
                                                            {techPackLoading === file.id ? 'Generating...' : 'Tech Pack'}
                                                        </button>
                                                    )}
                                                    <button className="st-export-trash-btn" title="Delete" onClick={() => deleteExports([file.id])} disabled={isDeleting}>
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
                        <div className="st-empty-canvas"><p>No {exportsFilter === 'vector' ? 'vector' : 'image'} files found.</p></div>
                    )}
                    {totalPages > 1 && (
                        <div className="st-pagination">
                            <button className="st-pagination-btn prev" onClick={() => setExportsPage(prev => Math.max(prev - 1, 1))} disabled={exportsPage === 1}>
                                <I d="M15 19l-7-7 7-7" s={14} /><span>Prev</span>
                            </button>
                            <div className="st-pagination-numbers">
                                {pageNumbers.map(number => (
                                    <button key={number} className={`st-pagination-number ${exportsPage === number ? 'active' : ''}`} onClick={() => setExportsPage(number)}>{number}</button>
                                ))}
                            </div>
                            <button className="st-pagination-btn next" onClick={() => setExportsPage(prev => Math.min(prev + 1, totalPages))} disabled={exportsPage === totalPages}>
                                <span>Next</span><I d="M9 5l7 7-7 7" s={14} />
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className="st-empty-canvas"><p>No exports generated yet for this project.</p></div>
            )}
        </div>
    );
}
