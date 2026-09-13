import { useEffect, useMemo, useState } from 'react';
import { I } from '../shared/StudioIcons';
import { apiFetch, cacheMediaFromResponse } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import { useImageDropzone } from '../shared/useImageDropzone';
import { useResultUrls } from '../../../stores/resultUrls';
import '../../../styles/tools/embroidery.css';

const TECHNIQUES = ['embroidery', 'lace', 'brocade', 'zari', 'applique', 'embellishment', 'other'];
const TECHNIQUE_LABELS = { applique: 'Appliqué' };
const ICON_TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';
const ICON_MOVE = 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20';
const ICON_EDIT = 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z';

const techniqueLabel = (value) => TECHNIQUE_LABELS[value] || value;

/**
 * Motif Library: the user's private catalogue of embroidery, lace, brocade, zari and appliqué
 * assets. Uploads can be cut out with Remove Background before they are catalogued, and any
 * motif can be sent straight to Placement Studio.
 */
export default function MotifLibraryTool(props) {
    const {
        uploaded, preview, uploadStatus, isUploading, activeProject, user, currentToken, creditPricing,
        setError, setNotice, setTool, setUploads, tool, updateCreditsFromResponse,
        handlePreUpload, onUploadInvalid, onUploadPaste,
    } = props;

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const setPendingMotif = useResultUrls((state) => state.setPendingMotif);

    const [motifs, setMotifs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [draft, setDraft] = useState({ name: '', technique: 'embroidery', tags: '', removeBg: true });
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');

    const removeBgCost = creditPricing?.removeBg || 2;
    const remainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const uploadReady = Boolean(uploaded?.filename) && uploadStatus === 'ready';

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await apiFetch('/api/motifs', {}, currentToken);
                if (cancelled) return;
                if (!data.success) throw new Error(data.error || 'Could not load motifs');
                (data.motifs || []).forEach((motif) => cacheMediaFromResponse({ filename: motif.filename, fileAccessToken: motif.fileAccessToken }));
                setMotifs(data.motifs || []);
            } catch (error) {
                if (!cancelled) setError(error.message || 'Could not load motifs');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [currentToken, setError]);

    // The uploaded file name is the default motif name until the user types one.
    const defaultName = uploaded?.originalName ? uploaded.originalName.replace(/\.[^.]+$/, '') : '';
    const nameValue = draft.name || defaultName;

    const visibleMotifs = useMemo(() => {
        const q = query.trim().toLowerCase();
        return motifs.filter((motif) => (
            (filter === 'all' || motif.technique === filter)
            && (!q || motif.name.toLowerCase().includes(q) || motif.tags.some((tag) => tag.includes(q)))
        ));
    }, [motifs, filter, query]);

    const counts = useMemo(() => {
        const map = { all: motifs.length };
        motifs.forEach((motif) => { map[motif.technique] = (map[motif.technique] || 0) + 1; });
        return map;
    }, [motifs]);

    const clearUpload = () => {
        if (typeof setUploads === 'function') {
            setUploads((prev) => {
                const next = { ...prev };
                delete next[tool];
                return next;
            });
        }
        setDraft({ name: '', technique: draft.technique, tags: '', removeBg: true });
    };

    const addMotif = async () => {
        if (!uploadReady) {
            if (isUploading) setError('Please wait, the image is still uploading.');
            else setError('Upload a motif image first (transparent PNG works best).');
            return;
        }
        if (draft.removeBg && remainingCredits < removeBgCost) {
            setError(`Remove Background needs ${removeBgCost} credits, but you have ${remainingCredits} remaining. Untick it to add the image as-is.`);
            return;
        }
        setIsAdding(true);
        try {
            let filename = uploaded.filename;
            let sourceFilename = null;
            if (draft.removeBg) {
                const cut = await apiFetch('/api/remove-bg', {
                    method: 'POST',
                    body: JSON.stringify({ filename: uploaded.filename, projectId: activeProject?.id, userId: user?.id }),
                }, currentToken);
                if (!cut.success) throw new Error(cut.error || 'Background removal failed');
                cacheMediaFromResponse(cut);
                updateCreditsFromResponse?.(cut);
                sourceFilename = uploaded.filename;
                filename = String(cut.resultUrl || '').split('/').pop();
            }
            const data = await apiFetch('/api/motifs', {
                method: 'POST',
                body: JSON.stringify({
                    filename,
                    sourceFilename,
                    name: nameValue.trim(),
                    technique: draft.technique,
                    tags: draft.tags,
                    projectId: activeProject?.id,
                }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not add motif');
            cacheMediaFromResponse({ filename: data.motif.filename, fileAccessToken: data.motif.fileAccessToken });
            setMotifs((prev) => [data.motif, ...prev]);
            setNotice?.(`Added "${data.motif.name}" to your library`);
            clearUpload();
        } catch (error) {
            setError(error.message || 'Could not add motif');
        } finally {
            setIsAdding(false);
        }
    };

    const deleteMotif = async (motif) => {
        if (!window.confirm(`Remove "${motif.name}" from your library? The image file is kept in your exports.`)) return;
        try {
            const data = await apiFetch(`/api/motifs/${motif.id}`, { method: 'DELETE' }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not remove motif');
            setMotifs((prev) => prev.filter((m) => m.id !== motif.id));
        } catch (error) {
            setError(error.message || 'Could not remove motif');
        }
    };

    const startRename = (motif) => {
        setEditingId(motif.id);
        setEditName(motif.name);
    };

    const commitRename = async (motif) => {
        const name = editName.trim();
        setEditingId(null);
        if (!name || name === motif.name) return;
        try {
            const data = await apiFetch(`/api/motifs/${motif.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not rename motif');
            setMotifs((prev) => prev.map((m) => (m.id === motif.id ? data.motif : m)));
        } catch (error) {
            setError(error.message || 'Could not rename motif');
        }
    };

    const changeTechnique = async (motif, technique) => {
        try {
            const data = await apiFetch(`/api/motifs/${motif.id}`, { method: 'PATCH', body: JSON.stringify({ technique }) }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not update motif');
            setMotifs((prev) => prev.map((m) => (m.id === motif.id ? data.motif : m)));
        } catch (error) {
            setError(error.message || 'Could not update motif');
        }
    };

    const sendToPlacement = (motif) => {
        setPendingMotif?.(motif);
        setTool?.('emb-placement');
    };

    return (
        <div {...pasteProps} className="emb-tool">
            <header className="emb-tool-head">
                <div>
                    <h1>Motif Library</h1>
                    <p>Your private packs of embroidery motifs, laces, borders, brocade and zari tiles. Upload transparent PNGs, or let Remove Background cut them out, then place them in Placement Studio.</p>
                </div>
                <div className="emb-head-actions">
                    <input
                        className="emb-input"
                        placeholder="Search by name or tag"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="Search motifs"
                        style={{ minWidth: 220 }}
                    />
                </div>
            </header>

            <div className="emb-chips" role="tablist" aria-label="Filter by technique">
                {['all', ...TECHNIQUES].map((value) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={filter === value}
                        className={`emb-chip${filter === value ? ' is-active' : ''}`}
                        onClick={() => setFilter(value)}
                    >
                        {value === 'all' ? 'All' : techniqueLabel(value)}{counts[value] ? ` · ${counts[value]}` : ''}
                    </button>
                ))}
            </div>

            <div className="emb-motifs-layout">
                <aside className="emb-panel" aria-label="Add a motif">
                    <h2 className="emb-panel-title"><strong>Add a motif</strong></h2>

                    {preview ? (
                        <div className="emb-upload-thumb">
                            <img src={preview} alt="Motif to add" />
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <strong>{uploaded?.originalName || 'Uploaded image'}</strong>
                                <UploadStatusBadge status={uploadStatus} />
                            </div>
                            <button type="button" className="emb-btn is-small" onClick={openFilePicker}>Replace</button>
                        </div>
                    ) : (
                        <ImageDropzone
                            variant="compact"
                            title="Upload a motif"
                            description="PNG with transparency is ideal. JPG works with background removal."
                            onFile={handlePreUpload}
                            onInvalidFile={onUploadInvalid}
                            onPasteSuccess={onUploadPaste}
                            uploadStatus={uploadStatus}
                        />
                    )}

                    <div className="emb-field">
                        <label htmlFor="emb-motif-name">Name</label>
                        <input id="emb-motif-name" className="emb-input" value={nameValue} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Paisley border" />
                    </div>
                    <div className="emb-field">
                        <label htmlFor="emb-motif-technique">Technique</label>
                        <select id="emb-motif-technique" className="emb-select" value={draft.technique} onChange={(e) => setDraft((d) => ({ ...d, technique: e.target.value }))}>
                            {TECHNIQUES.map((value) => <option key={value} value={value}>{techniqueLabel(value)}</option>)}
                        </select>
                    </div>
                    <div className="emb-field">
                        <label htmlFor="emb-motif-tags">Tags</label>
                        <input id="emb-motif-tags" className="emb-input" value={draft.tags} onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} placeholder="border, floral, saree" />
                    </div>
                    <label className="emb-checkbox">
                        <input type="checkbox" checked={draft.removeBg} onChange={(e) => setDraft((d) => ({ ...d, removeBg: e.target.checked }))} />
                        Remove background first ({removeBgCost} credits)
                    </label>
                    <button type="button" className="emb-btn is-primary" onClick={addMotif} disabled={!uploadReady || isAdding}>
                        {isAdding ? (draft.removeBg ? 'Cutting out…' : 'Adding…') : 'Add to library'}
                    </button>
                    <p className="emb-hint">Motifs reference files you already own. Removing one from the library never deletes the image.</p>
                </aside>

                <section aria-label="Motifs">
                    {isLoading ? (
                        <div className="emb-empty">Loading your library…</div>
                    ) : visibleMotifs.length === 0 ? (
                        <div className="emb-empty">
                            <strong>{motifs.length === 0 ? 'Your library is empty' : 'Nothing matches this filter'}</strong>
                            {motifs.length === 0
                                ? 'Upload your first lace, zari border or motif on the left. Packs you add here become layers in Placement Studio.'
                                : 'Try another technique or clear the search.'}
                        </div>
                    ) : (
                        <div className="emb-motif-grid">
                            {visibleMotifs.map((motif) => (
                                <article key={motif.id} className="emb-motif-card">
                                    <div className="emb-motif-thumb">
                                        <MediaImg src={motif.url} alt={motif.name} token={currentToken} accessToken={motif.fileAccessToken} loading="lazy" />
                                    </div>
                                    <div className="emb-motif-body">
                                        {editingId === motif.id ? (
                                            <input
                                                className="emb-input"
                                                value={editName}
                                                autoFocus
                                                onChange={(e) => setEditName(e.target.value)}
                                                onBlur={() => commitRename(motif)}
                                                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(motif); if (e.key === 'Escape') setEditingId(null); }}
                                                aria-label="Motif name"
                                            />
                                        ) : (
                                            <div className="emb-motif-name" title={motif.name}>{motif.name}</div>
                                        )}
                                        <div className="emb-motif-meta">
                                            <select
                                                className="emb-technique"
                                                value={motif.technique}
                                                onChange={(e) => changeTechnique(motif, e.target.value)}
                                                aria-label={`Technique for ${motif.name}`}
                                                style={{ border: 0, cursor: 'pointer' }}
                                            >
                                                {TECHNIQUES.map((value) => <option key={value} value={value}>{techniqueLabel(value)}</option>)}
                                            </select>
                                            {motif.width && motif.height && <span>{motif.width}×{motif.height}</span>}
                                            {motif.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
                                        </div>
                                    </div>
                                    <div className="emb-motif-actions">
                                        <button type="button" className="emb-btn is-small is-primary" onClick={() => sendToPlacement(motif)} title="Open in Placement Studio">
                                            <I d={ICON_MOVE} s={13} /> Place
                                        </button>
                                        <button type="button" className="emb-btn is-small" onClick={() => startRename(motif)} aria-label={`Rename ${motif.name}`} title="Rename">
                                            <I d={ICON_EDIT} s={13} />
                                        </button>
                                        <button type="button" className="emb-btn is-small is-danger" onClick={() => deleteMotif(motif)} aria-label={`Remove ${motif.name}`} title="Remove from library">
                                            <I d={ICON_TRASH} s={13} />
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>
            <input {...inputProps} />
        </div>
    );
}
