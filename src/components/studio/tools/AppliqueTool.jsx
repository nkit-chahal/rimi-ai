import { useEffect, useMemo, useState } from 'react';
import { I } from '../shared/StudioIcons';
import { apiFetch, cacheMediaFromResponse, forceDownload, mediaUrl } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import { useImageDropzone } from '../shared/useImageDropzone';
import { useResultUrls } from '../../../stores/resultUrls';
import { normalizeHex } from '../shared/shadeCardImport';
import '../../../styles/tools/embroidery.css';

const ICON_MOVE = 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20';
const ICON_DOWNLOAD = 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3';
const ICON_SHUFFLE = 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5';

const EDGE_STYLES = [
    { id: 'satin', label: 'Satin stitch' },
    { id: 'blanket', label: 'Blanket stitch' },
    { id: 'none', label: 'Raw edge' },
];
const KINDS = [
    { id: 'sequin', label: 'Sequins' },
    { id: 'bead', label: 'Beads' },
    { id: 'mirror', label: 'Mirror work' },
];
const LAYOUTS = [
    { id: 'row', label: 'Border row' },
    { id: 'scatter', label: 'Scatter' },
    { id: 'cluster', label: 'Cluster' },
];
const SHEET_PRESETS = [
    { id: 'border', label: 'Border strip', width: 1200, height: 200 },
    { id: 'square', label: 'Square', width: 600, height: 600 },
    { id: 'small', label: 'Small motif', width: 300, height: 300 },
];
const TECHNIQUE_LABELS = { applique: 'Appliqué' };
const techniqueLabel = (value) => TECHNIQUE_LABELS[value] || value;

function isServerPath(url) {
    return typeof url === 'string' && (url.startsWith('/results/') || url.startsWith('/uploads/'));
}

/**
 * Appliqué & Embellishment: cut a fabric or solid into a motif's silhouette with a stitched edge,
 * or generate sheets of sequins, beads and mirror work. Every result lands in the Motif Library
 * and can be placed straight away.
 */
export default function AppliqueTool(props) {
    const {
        uploaded, preview, uploadStatus, activeProject, user, currentToken, creditPricing,
        setError, setNotice, setTool, updateCreditsFromResponse,
        handlePreUpload, onUploadInvalid, onUploadPaste,
    } = props;

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });
    const setPendingMotif = useResultUrls((state) => state.setPendingMotif);

    const [tab, setTab] = useState('applique');
    const [motifs, setMotifs] = useState([]);
    const [motifsLoaded, setMotifsLoaded] = useState(false);
    const [shape, setShape] = useState(null);            // { filename, url, name, fileAccessToken }
    const [fillKind, setFillKind] = useState('solid');   // solid | image
    const [fillColor, setFillColor] = useState('#c8283c');
    const [fillImage, setFillImage] = useState(null);    // { filename, url, name }
    const [fillScale, setFillScale] = useState(0.5);
    const [edgeStyle, setEdgeStyle] = useState('satin');
    const [edgeColor, setEdgeColor] = useState('#f5dc78');
    const [edgeWidth, setEdgeWidth] = useState(6);
    const [shadow, setShadow] = useState(true);
    const [patchName, setPatchName] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [results, setResults] = useState([]);

    const [kind, setKind] = useState('sequin');
    const [layout, setLayout] = useState('row');
    const [count, setCount] = useState(24);
    const [size, setSize] = useState(28);
    const [colors, setColors] = useState(['#e6bd5a', '#c8102e']);
    const [preset, setPreset] = useState('border');
    const [seed, setSeed] = useState(7);
    const [sheetName, setSheetName] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const appliqueCost = creditPricing?.appliqueCreate || 2;
    const embellishCost = creditPricing?.embellishGenerate || 1;
    const remainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const uploadReady = Boolean(uploaded?.filename) && uploadStatus === 'ready';
    const heroPath = isServerPath(activeProject?.heroImageUrl) ? activeProject.heroImageUrl : null;

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
                if (!cancelled) setMotifsLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [currentToken, setError]);

    const fillCandidates = useMemo(() => motifs.filter((motif) => ['brocade', 'lace', 'other', 'embroidery'].includes(motif.technique)), [motifs]);

    const registerResult = (data, label) => {
        cacheMediaFromResponse(data);
        updateCreditsFromResponse?.(data);
        if (data.motif) cacheMediaFromResponse({ filename: data.motif.filename, fileAccessToken: data.motif.fileAccessToken });
        setResults((prev) => [{ ...data, label }, ...prev].slice(0, 12));
        if (data.motif) setMotifs((prev) => [data.motif, ...prev]);
        setNotice?.(`${label} added to your Motif Library`);
    };

    const createPatch = async () => {
        if (!shape?.filename) {
            setError('Choose a shape first: a motif from your library or an uploaded image.');
            return;
        }
        if (fillKind === 'image' && !fillImage?.filename) {
            setError('Choose a print or fabric to fill the patch with, or switch to a solid colour.');
            return;
        }
        if (remainingCredits < appliqueCost) {
            setError(`Appliqué needs ${appliqueCost} credits, but you have ${remainingCredits} remaining.`);
            return;
        }
        setIsCreating(true);
        try {
            const data = await apiFetch('/api/applique/create', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: activeProject?.id,
                    shapeFilename: shape.filename,
                    fill: fillKind === 'image' ? { kind: 'image', filename: fillImage.filename, scale: fillScale } : { kind: 'solid', color: normalizeHex(fillColor) || '#c8283c' },
                    edge: { style: edgeStyle, color: normalizeHex(edgeColor) || '#f5dc78', width: edgeWidth },
                    shadow,
                    saveToLibrary: true,
                    name: patchName.trim() || `${shape.name || 'Motif'} appliqué`,
                    tags: ['applique', edgeStyle],
                }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Appliqué failed');
            registerResult(data, data.motif?.name || 'Appliqué patch');
        } catch (error) {
            setError(error.message || 'Appliqué failed');
        } finally {
            setIsCreating(false);
        }
    };

    const generateSheet = async () => {
        if (remainingCredits < embellishCost) {
            setError(`Embellishments need ${embellishCost} credit, but you have ${remainingCredits} remaining.`);
            return;
        }
        const dims = SHEET_PRESETS.find((item) => item.id === preset) || SHEET_PRESETS[0];
        setIsGenerating(true);
        try {
            const data = await apiFetch('/api/embellish/generate', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: activeProject?.id,
                    kind,
                    layout,
                    count,
                    size,
                    colors: colors.map((c) => normalizeHex(c)).filter(Boolean),
                    width: dims.width,
                    height: dims.height,
                    seed,
                    saveToLibrary: true,
                    name: sheetName.trim() || `${KINDS.find((k) => k.id === kind)?.label || 'Embellishment'} ${LAYOUTS.find((l) => l.id === layout)?.label.toLowerCase() || ''}`.trim(),
                    tags: ['embellishment', kind, layout],
                }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Embellishment failed');
            registerResult(data, data.motif?.name || 'Embellishment sheet');
        } catch (error) {
            setError(error.message || 'Embellishment failed');
        } finally {
            setIsGenerating(false);
        }
    };

    const placeResult = (result) => {
        const motif = result.motif || { id: null, name: result.label, filename: result.filename, url: result.resultUrl, fileAccessToken: result.fileAccessToken, width: result.width, height: result.height };
        setPendingMotif?.(motif);
        setTool?.('emb-placement');
    };

    const renderMotifPicker = (list, onPick, activeFilename) => (
        <div className="emb-motif-picker" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
            {list.map((motif) => (
                <button
                    key={motif.id}
                    type="button"
                    className={`emb-motif-pick${activeFilename === motif.filename ? ' is-active' : ''}`}
                    onClick={() => onPick(motif)}
                    title={motif.name}
                    aria-pressed={activeFilename === motif.filename}
                >
                    <span className="emb-motif-thumb"><MediaImg src={motif.url} alt="" token={currentToken} accessToken={motif.fileAccessToken} loading="lazy" /></span>
                    <span className="emb-motif-name">{motif.name}</span>
                    <span className="emb-technique">{techniqueLabel(motif.technique)}</span>
                </button>
            ))}
        </div>
    );

    const renderApplique = () => (
        <div className="emb-grid-2">
            <section className="emb-panel" aria-label="Appliqué settings">
                <h2 className="emb-panel-title"><strong>1. Shape</strong><span>{shape ? shape.name : 'none chosen'}</span></h2>
                {preview ? (
                    <div className="emb-upload-thumb">
                        <img src={preview} alt="Uploaded shape" />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <strong>{uploaded?.originalName || 'Uploaded image'}</strong>
                            <UploadStatusBadge status={uploadStatus} />
                        </div>
                        <button type="button" className="emb-btn is-small" disabled={!uploadReady} onClick={() => setShape({ filename: uploaded.filename, url: `/uploads/${uploaded.filename}`, name: (uploaded.originalName || 'Upload').replace(/\.[^.]+$/, '') })}>Use as shape</button>
                        <button type="button" className="emb-btn is-small" onClick={openFilePicker}>Replace</button>
                    </div>
                ) : (
                    <ImageDropzone
                        variant="compact"
                        title="Upload a shape"
                        description="A transparent PNG gives the cleanest silhouette"
                        onFile={handlePreUpload}
                        onInvalidFile={onUploadInvalid}
                        onPasteSuccess={onUploadPaste}
                        uploadStatus={uploadStatus}
                    />
                )}
                <p className="emb-hint">Or pick a motif from your library. Its silhouette becomes the patch outline.</p>
                {motifsLoaded && motifs.length > 0 && renderMotifPicker(motifs, (motif) => setShape({ filename: motif.filename, url: motif.url, name: motif.name, fileAccessToken: motif.fileAccessToken }), shape?.filename)}
                {motifsLoaded && motifs.length === 0 && <p className="emb-hint">Your library is empty. Upload a shape above or add motifs in the Motif Library.</p>}

                <h2 className="emb-panel-title"><strong>2. Fill</strong></h2>
                <div className="emb-chips" role="tablist" aria-label="Fill kind">
                    <button type="button" role="tab" aria-selected={fillKind === 'solid'} className={`emb-chip${fillKind === 'solid' ? ' is-active' : ''}`} onClick={() => setFillKind('solid')}>Solid fabric</button>
                    <button type="button" role="tab" aria-selected={fillKind === 'image'} className={`emb-chip${fillKind === 'image' ? ' is-active' : ''}`} onClick={() => setFillKind('image')}>Print or brocade</button>
                </div>
                {fillKind === 'solid' ? (
                    <div className="emb-field-row">
                        <input type="color" className="emb-color-input" value={normalizeHex(fillColor) || '#c8283c'} onChange={(e) => setFillColor(e.target.value)} aria-label="Fill colour" />
                        <input className="emb-input is-mono" value={fillColor} onChange={(e) => setFillColor(e.target.value)} aria-label="Fill hex" style={{ width: 120 }} />
                    </div>
                ) : (
                    <>
                        <div className="emb-field-row">
                            {heroPath && (
                                <button type="button" className={`emb-btn is-small${fillImage?.filename === heroPath.split('/').pop() ? ' is-primary' : ''}`} onClick={() => setFillImage({ filename: heroPath.split('/').pop(), url: heroPath, name: 'Project image' })}>Use project print</button>
                            )}
                            {uploadReady && (
                                <button type="button" className={`emb-btn is-small${fillImage?.filename === uploaded.filename ? ' is-primary' : ''}`} onClick={() => setFillImage({ filename: uploaded.filename, url: `/uploads/${uploaded.filename}`, name: uploaded.originalName || 'Upload' })}>Use uploaded image</button>
                            )}
                            <span className="emb-hint">{fillImage ? `Fill: ${fillImage.name}` : 'Pick a print, or a brocade / lace tile from the library below.'}</span>
                        </div>
                        {fillCandidates.length > 0 && renderMotifPicker(fillCandidates, (motif) => setFillImage({ filename: motif.filename, url: motif.url, name: motif.name }), fillImage?.filename)}
                        <label className="emb-field">
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)' }}>Tile size {Math.round(fillScale * 100)}% of the patch width</span>
                            <input className="emb-range" type="range" min="10" max="100" value={Math.round(fillScale * 100)} onChange={(e) => setFillScale(Number(e.target.value) / 100)} />
                        </label>
                    </>
                )}

                <h2 className="emb-panel-title"><strong>3. Edge finish</strong></h2>
                <div className="emb-chips" role="tablist" aria-label="Edge style">
                    {EDGE_STYLES.map((style) => (
                        <button key={style.id} type="button" role="tab" aria-selected={edgeStyle === style.id} className={`emb-chip${edgeStyle === style.id ? ' is-active' : ''}`} onClick={() => setEdgeStyle(style.id)}>{style.label}</button>
                    ))}
                </div>
                {edgeStyle !== 'none' && (
                    <div className="emb-field-row">
                        <input type="color" className="emb-color-input" value={normalizeHex(edgeColor) || '#f5dc78'} onChange={(e) => setEdgeColor(e.target.value)} aria-label="Thread colour" />
                        <label className="emb-field" style={{ flex: 1 }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)' }}>Stitch width {edgeWidth}px</span>
                            <input className="emb-range" type="range" min="2" max="24" value={edgeWidth} onChange={(e) => setEdgeWidth(Number(e.target.value))} />
                        </label>
                    </div>
                )}
                <label className="emb-checkbox">
                    <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} />
                    Soft shadow under the patch
                </label>
                <div className="emb-field-row">
                    <input className="emb-input" placeholder="Patch name" value={patchName} onChange={(e) => setPatchName(e.target.value)} aria-label="Patch name" style={{ flex: 1, minWidth: 160 }} />
                    <button type="button" className="emb-btn is-primary" onClick={createPatch} disabled={isCreating || !shape}>
                        {isCreating ? 'Cutting…' : `Create patch (${appliqueCost} credits)`}
                    </button>
                </div>
            </section>

            <section className="emb-panel" aria-label="Results">
                <h2 className="emb-panel-title"><strong>Results</strong><span>saved to your library</span></h2>
                {results.length === 0 ? (
                    <div className="emb-empty">
                        <strong>Nothing created yet</strong>
                        Patches and embellishment sheets appear here, ready to place.
                    </div>
                ) : (
                    <div className="emb-motif-grid">
                        {results.map((result) => (
                            <article key={result.filename} className="emb-motif-card">
                                <div className="emb-motif-thumb"><MediaImg src={result.resultUrl} alt={result.label} token={currentToken} accessToken={result.fileAccessToken} /></div>
                                <div className="emb-motif-body">
                                    <div className="emb-motif-name" title={result.label}>{result.label}</div>
                                    <div className="emb-motif-meta"><span>{result.width}×{result.height}</span></div>
                                </div>
                                <div className="emb-motif-actions">
                                    <button type="button" className="emb-btn is-small is-primary" onClick={() => placeResult(result)}><I d={ICON_MOVE} s={13} /> Place</button>
                                    <button type="button" className="emb-btn is-small" onClick={(e) => forceDownload(e, mediaUrl(result.resultUrl), result.filename, currentToken)} aria-label={`Download ${result.label}`}><I d={ICON_DOWNLOAD} s={13} /></button>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );

    const renderEmbellish = () => (
        <div className="emb-grid-2">
            <section className="emb-panel" aria-label="Embellishment settings">
                <h2 className="emb-panel-title"><strong>Embellishment sheet</strong><span>{embellishCost} credit</span></h2>
                <div className="emb-chips" role="tablist" aria-label="Kind">
                    {KINDS.map((item) => (
                        <button key={item.id} type="button" role="tab" aria-selected={kind === item.id} className={`emb-chip${kind === item.id ? ' is-active' : ''}`} onClick={() => setKind(item.id)}>{item.label}</button>
                    ))}
                </div>
                <div className="emb-chips" role="tablist" aria-label="Layout">
                    {LAYOUTS.map((item) => (
                        <button key={item.id} type="button" role="tab" aria-selected={layout === item.id} className={`emb-chip${layout === item.id ? ' is-active' : ''}`} onClick={() => setLayout(item.id)}>{item.label}</button>
                    ))}
                </div>
                <div className="emb-field-row">
                    <label className="emb-field" style={{ flex: 1 }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)' }}>Count {count}</span>
                        <input className="emb-range" type="range" min="1" max="200" value={count} onChange={(e) => setCount(Number(e.target.value))} />
                    </label>
                    <label className="emb-field" style={{ flex: 1 }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)' }}>Size {size}px</span>
                        <input className="emb-range" type="range" min="8" max="120" value={size} onChange={(e) => setSize(Number(e.target.value))} />
                    </label>
                </div>
                <div className="emb-field">
                    <label>{kind === 'mirror' ? 'Thread colours around the mirrors' : 'Colours'}</label>
                    <div className="emb-field-row">
                        {colors.map((color, index) => (
                            <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <input type="color" className="emb-color-input" value={normalizeHex(color) || '#e6bd5a'} onChange={(e) => setColors((prev) => prev.map((c, i) => (i === index ? e.target.value : c)))} aria-label={`Colour ${index + 1}`} />
                                {colors.length > 1 && (
                                    <button type="button" className="emb-icon-btn" style={{ marginLeft: 0 }} onClick={() => setColors((prev) => prev.filter((_, i) => i !== index))} aria-label={`Remove colour ${index + 1}`}>×</button>
                                )}
                            </span>
                        ))}
                        {colors.length < 4 && <button type="button" className="emb-btn is-small" onClick={() => setColors((prev) => [...prev, '#2bb3c0'])}>+ colour</button>}
                    </div>
                </div>
                <div className="emb-chips" role="tablist" aria-label="Sheet size">
                    {SHEET_PRESETS.map((item) => (
                        <button key={item.id} type="button" role="tab" aria-selected={preset === item.id} className={`emb-chip${preset === item.id ? ' is-active' : ''}`} onClick={() => setPreset(item.id)}>{item.label} · {item.width}×{item.height}</button>
                    ))}
                </div>
                <div className="emb-field-row">
                    <input className="emb-input" placeholder="Sheet name" value={sheetName} onChange={(e) => setSheetName(e.target.value)} aria-label="Sheet name" style={{ flex: 1, minWidth: 160 }} />
                    <button type="button" className="emb-btn is-small" onClick={() => setSeed(Math.floor(Math.random() * 100000))} title="Shuffle the arrangement"><I d={ICON_SHUFFLE} s={14} /> Shuffle</button>
                    <button type="button" className="emb-btn is-primary" onClick={generateSheet} disabled={isGenerating}>{isGenerating ? 'Drawing…' : `Generate (${embellishCost} credit)`}</button>
                </div>
                <p className="emb-hint">Sheets are drawn procedurally, so the same settings and seed always give the same arrangement.</p>
            </section>

            <section className="emb-panel" aria-label="Results">
                <h2 className="emb-panel-title"><strong>Results</strong><span>saved to your library</span></h2>
                {results.length === 0 ? (
                    <div className="emb-empty">
                        <strong>Nothing generated yet</strong>
                        Sequin rows, bead clusters and mirror work land here, ready to place.
                    </div>
                ) : (
                    <div className="emb-motif-grid">
                        {results.map((result) => (
                            <article key={result.filename} className="emb-motif-card">
                                <div className="emb-motif-thumb"><MediaImg src={result.resultUrl} alt={result.label} token={currentToken} accessToken={result.fileAccessToken} /></div>
                                <div className="emb-motif-body">
                                    <div className="emb-motif-name" title={result.label}>{result.label}</div>
                                    <div className="emb-motif-meta"><span>{result.width}×{result.height}</span></div>
                                </div>
                                <div className="emb-motif-actions">
                                    <button type="button" className="emb-btn is-small is-primary" onClick={() => placeResult(result)}><I d={ICON_MOVE} s={13} /> Place</button>
                                    <button type="button" className="emb-btn is-small" onClick={(e) => forceDownload(e, mediaUrl(result.resultUrl), result.filename, currentToken)} aria-label={`Download ${result.label}`}><I d={ICON_DOWNLOAD} s={13} /></button>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );

    return (
        <div {...pasteProps} className="emb-tool">
            <header className="emb-tool-head">
                <div>
                    <h1>Appliqué & Embellishment</h1>
                    <p>Cut a fabric or a print into a motif's silhouette with a satin or blanket-stitched edge, or draw sheets of sequins, beads and mirror work. Everything you make joins your Motif Library.</p>
                </div>
                <div className="emb-chips" role="tablist" aria-label="Tool">
                    <button type="button" role="tab" aria-selected={tab === 'applique'} className={`emb-chip${tab === 'applique' ? ' is-active' : ''}`} onClick={() => setTab('applique')}>Appliqué patch</button>
                    <button type="button" role="tab" aria-selected={tab === 'embellish'} className={`emb-chip${tab === 'embellish' ? ' is-active' : ''}`} onClick={() => setTab('embellish')}>Embellishments</button>
                </div>
            </header>
            {tab === 'applique' ? renderApplique() : renderEmbellish()}
            <input {...inputProps} />
        </div>
    );
}
