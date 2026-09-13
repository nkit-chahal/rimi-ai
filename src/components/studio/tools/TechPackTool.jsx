import { useEffect, useMemo, useState } from 'react';
import { I } from '../shared/StudioIcons';
import { apiFetch, cacheMediaFromResponse, forceDownload, mediaUrl } from '../shared/helpers';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import { useImageDropzone } from '../shared/useImageDropzone';
import { useResultUrls } from '../../../stores/resultUrls';
import { loadDraft } from '../shared/placementDocument';
import { EMBROIDERY_FABRICS, EMBROIDERY_PRODUCTS, EMBROIDERY_TECHNIQUES, productById } from '../shared/embroideryMockups';
import '../../../styles/tools/embroidery.css';

const ICON_DOWNLOAD = 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3';
const STITCH_STYLES = [
    { id: 'satin', label: 'Satin' }, { id: 'fill', label: 'Tatami fill' }, { id: 'chain', label: 'Chain' }, { id: 'french_knot', label: 'French knots' },
    { id: 'zardozi', label: 'Zardozi' }, { id: 'aari', label: 'Aari' }, { id: 'kantha', label: 'Kantha' }, { id: 'cross', label: 'Cross stitch' },
];
const DENSITIES = ['light', 'medium', 'dense'];

const fmt = (value, digits = 1) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-');

/**
 * Embroidery Tech Pack: a production PDF built from the flattened design, the placement layers
 * (with a stitch style each), the saved thread palette and the product, zone and fabric choices.
 */
export default function TechPackTool(props) {
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
    const lastPlacement = useResultUrls((state) => state.lastPlacementResult);
    const projectId = activeProject?.id;

    const [design, setDesign] = useState(null);
    const [draft] = useState(() => loadDraft(projectId));
    const [layerChoices, setLayerChoices] = useState(() => Object.fromEntries((loadDraft(projectId)?.layers || []).map((layer) => [layer.id, { include: layer.visible !== false, stitchStyle: 'satin', density: 'medium' }])));
    const [physicalWidthCm, setPhysicalWidthCm] = useState(30);
    const [productId, setProductId] = useState('saree');
    const [zone, setZone] = useState('pallu');
    const [technique, setTechnique] = useState('zari');
    const [fabric, setFabric] = useState('silk');
    const [palettes, setPalettes] = useState([]);
    const [paletteId, setPaletteId] = useState('');
    const [company, setCompany] = useState('');
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState(null);

    const cost = creditPricing?.embroideryTechPack || 3;
    const remainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const uploadReady = Boolean(uploaded?.filename) && uploadStatus === 'ready';
    const product = productById(productId);
    const zones = product?.zones || [];
    const effectiveZone = zones.includes(zone) ? zone : zones[0] || '';

    useEffect(() => {
        if (!projectId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const data = await apiFetch(`/api/thread-palettes?projectId=${projectId}`, {}, currentToken);
                if (!cancelled && data.success) setPalettes(data.palettes || []);
            } catch {
                // Threads are optional in the pack.
            }
        })();
        return () => { cancelled = true; };
    }, [projectId, currentToken]);

    const docWidth = draft?.width || lastPlacement?.width || null;
    const docHeight = draft?.height || lastPlacement?.height || null;
    const pxPerCm = docWidth && physicalWidthCm > 0 ? docWidth / physicalWidthCm : null;
    const physicalHeight = pxPerCm && docHeight ? docHeight / pxPerCm : null;

    const layersPayload = useMemo(() => (draft?.layers || [])
        .filter((layer) => layerChoices[layer.id]?.include)
        .map((layer) => ({
            name: layer.name,
            filename: layer.filename,
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            scaleX: layer.scaleX ?? 1,
            scaleY: layer.scaleY ?? 1,
            angle: layer.angle ?? 0,
            stitchStyle: layerChoices[layer.id]?.stitchStyle || 'satin',
            density: layerChoices[layer.id]?.density || 'medium',
        })), [draft, layerChoices]);

    const selectedPalette = palettes.find((palette) => String(palette.id) === String(paletteId)) || null;

    const generate = async () => {
        if (!design?.filename && !draft) {
            setError('Choose the flattened design or build a placement first.');
            return;
        }
        if (remainingCredits < cost) {
            setError(`A tech pack needs ${cost} credits, but you have ${remainingCredits} remaining.`);
            return;
        }
        setIsGenerating(true);
        try {
            const data = await apiFetch('/api/techpack/embroidery', {
                method: 'POST',
                body: JSON.stringify({
                    projectId,
                    designFilename: design?.filename,
                    docWidthPx: docWidth,
                    docHeightPx: docHeight,
                    physicalWidthCm,
                    product: product?.label,
                    zone: effectiveZone,
                    technique: EMBROIDERY_TECHNIQUES.find((t) => t.id === technique)?.label || technique,
                    fabric,
                    base: draft?.base?.kind === 'image' ? 'print' : draft?.base?.kind === 'swatch' ? draft.base.swatch : draft?.base?.color,
                    layers: layersPayload,
                    threads: selectedPalette?.entries || [],
                    threadCard: selectedPalette ? `${selectedPalette.name} (${selectedPalette.cardId || 'card'})` : '',
                    title: title.trim() || undefined,
                    company: company.trim() || undefined,
                    notes: notes.trim(),
                }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Tech pack failed');
            cacheMediaFromResponse(data);
            updateCreditsFromResponse?.(data);
            setResult(data);
            setNotice?.(`Tech pack ready: ${data.summary.totalStitches.toLocaleString()} estimated stitches`);
        } catch (error) {
            setError(error.message || 'Tech pack failed');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div {...pasteProps} className="emb-tool">
            <header className="emb-tool-head">
                <div>
                    <h1>Embroidery Tech Pack</h1>
                    <p>A production sheet for the embroidery unit: the design, each motif's position and size in centimetres, the stitch style and estimated stitch count, the thread shades, and stabiliser notes for the fabric.</p>
                </div>
            </header>

            <div className="emb-grid-2">
                <section className="emb-panel" aria-label="Tech pack inputs">
                    <h2 className="emb-panel-title"><strong>1. Design</strong><span>{design ? design.name : 'none chosen'}</span></h2>
                    <div className="emb-field-row">
                        {lastPlacement ? (
                            <button type="button" className={`emb-btn is-small${design?.filename === lastPlacement.filename ? ' is-primary' : ''}`} onClick={() => setDesign({ filename: lastPlacement.filename, url: lastPlacement.url, name: 'Latest placement' })}>Use latest placement</button>
                        ) : (
                            <button type="button" className="emb-btn is-small" onClick={() => setTool?.('emb-placement')}>Open Placement Studio</button>
                        )}
                        {uploadReady && (
                            <button type="button" className={`emb-btn is-small${design?.filename === uploaded.filename ? ' is-primary' : ''}`} onClick={() => setDesign({ filename: uploaded.filename, url: `/uploads/${uploaded.filename}`, name: uploaded.originalName || 'Upload' })}>Use uploaded design</button>
                        )}
                    </div>
                    {preview ? (
                        <div className="emb-upload-thumb">
                            <img src={preview} alt="Uploaded design" />
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <strong>{uploaded?.originalName || 'Uploaded design'}</strong>
                                <UploadStatusBadge status={uploadStatus} />
                            </div>
                            <button type="button" className="emb-btn is-small" onClick={openFilePicker}>Replace</button>
                        </div>
                    ) : (
                        <ImageDropzone variant="compact" title="Upload the flattened design" description="Or use your latest Placement Studio flatten" onFile={handlePreUpload} onInvalidFile={onUploadInvalid} onPasteSuccess={onUploadPaste} uploadStatus={uploadStatus} />
                    )}

                    <h2 className="emb-panel-title"><strong>2. Real-world size</strong></h2>
                    <div className="emb-field-row">
                        <label className="emb-field">
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)' }}>Design width (cm)</span>
                            <input className="emb-input" type="number" min="1" max="500" step="0.5" value={physicalWidthCm} onChange={(e) => setPhysicalWidthCm(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} aria-label="Design width in centimetres" style={{ width: 120 }} />
                        </label>
                        <p className="emb-hint">
                            {docWidth ? `${docWidth}×${docHeight} px → ${fmt(physicalWidthCm)} × ${fmt(physicalHeight)} cm at ${fmt(pxPerCm)} px/cm` : 'Document size comes from the placement draft or the flattened design.'}
                        </p>
                    </div>

                    <h2 className="emb-panel-title"><strong>3. Motifs</strong><span>{draft ? `${draft.layers.length} in placement draft` : 'no placement draft'}</span></h2>
                    {draft?.layers?.length ? (
                        <ul className="emb-layer-list" aria-label="Placement layers">
                            {draft.layers.map((layer) => {
                                const choice = layerChoices[layer.id] || { include: true, stitchStyle: 'satin', density: 'medium' };
                                return (
                                    <li key={layer.id} className="emb-layer-row" style={{ cursor: 'default', gap: '0.5rem' }}>
                                        <label className="emb-checkbox" style={{ flex: 1, minWidth: 0 }}>
                                            <input type="checkbox" checked={choice.include} onChange={(e) => setLayerChoices((prev) => ({ ...prev, [layer.id]: { ...choice, include: e.target.checked } }))} aria-label={`Include ${layer.name}`} />
                                            <span className="name">{layer.name}</span>
                                        </label>
                                        <select className="emb-select" style={{ minHeight: 32, padding: '0.2rem 0.4rem', fontSize: '0.76rem' }} value={choice.stitchStyle} onChange={(e) => setLayerChoices((prev) => ({ ...prev, [layer.id]: { ...choice, stitchStyle: e.target.value } }))} aria-label={`Stitch style for ${layer.name}`}>
                                            {STITCH_STYLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                                        </select>
                                        <select className="emb-select" style={{ minHeight: 32, padding: '0.2rem 0.4rem', fontSize: '0.76rem' }} value={choice.density} onChange={(e) => setLayerChoices((prev) => ({ ...prev, [layer.id]: { ...choice, density: e.target.value } }))} aria-label={`Density for ${layer.name}`}>
                                            {DENSITIES.map((item) => <option key={item} value={item}>{item}</option>)}
                                        </select>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p className="emb-hint">Build the design in Placement Studio to list each motif with its position and a stitch style. You can still generate a pack for an uploaded design.</p>
                    )}

                    <h2 className="emb-panel-title"><strong>4. Product, technique, threads</strong></h2>
                    <div className="emb-field-row">
                        <select className="emb-select" value={productId} onChange={(e) => { setProductId(e.target.value); const next = productById(e.target.value); if (next && !next.zones.includes(zone)) setZone(next.zones[0]); }} aria-label="Product" style={{ flex: 1 }}>
                            {EMBROIDERY_PRODUCTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                        <select className="emb-select" value={effectiveZone} onChange={(e) => setZone(e.target.value)} aria-label="Zone" style={{ flex: 1 }}>
                            {zones.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </div>
                    <div className="emb-field-row">
                        <select className="emb-select" value={technique} onChange={(e) => setTechnique(e.target.value)} aria-label="Technique" style={{ flex: 1 }}>
                            {EMBROIDERY_TECHNIQUES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                        <select className="emb-select" value={fabric} onChange={(e) => setFabric(e.target.value)} aria-label="Fabric" style={{ flex: 1 }}>
                            {EMBROIDERY_FABRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                    </div>
                    <select className="emb-select" value={paletteId} onChange={(e) => setPaletteId(e.target.value)} aria-label="Thread palette">
                        <option value="">No thread list</option>
                        {palettes.map((palette) => <option key={palette.id} value={palette.id}>{palette.name} · {palette.entries.length} shades</option>)}
                    </select>
                    {palettes.length === 0 && <p className="emb-hint">Save a thread palette in Thread Shades to include shade codes in the pack.</p>}

                    <h2 className="emb-panel-title"><strong>5. Details</strong></h2>
                    <div className="emb-field-row">
                        <input className="emb-input" placeholder="Pack title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Pack title" style={{ flex: 1, minWidth: 140 }} />
                        <input className="emb-input" placeholder="Company / brand" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company" style={{ flex: 1, minWidth: 140 }} />
                    </div>
                    <textarea className="emb-input" rows={3} placeholder="Notes for the embroidery unit" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
                    <button type="button" className="emb-btn is-primary" onClick={generate} disabled={isGenerating || (!design && !draft)}>
                        {isGenerating ? 'Building PDF…' : `Generate tech pack (${cost} credits)`}
                    </button>
                </section>

                <section className="emb-panel" aria-label="Tech pack result">
                    <h2 className="emb-panel-title"><strong>Result</strong></h2>
                    {!result ? (
                        <div className="emb-empty">
                            <strong>No tech pack yet</strong>
                            The PDF and the stitch estimates appear here. Estimates are for planning; the digitised file is authoritative.
                        </div>
                    ) : (
                        <>
                            <div className="emb-field-row">
                                <button type="button" className="emb-btn is-primary" onClick={(e) => forceDownload(e, mediaUrl(result.resultUrl), result.filename, currentToken)}>
                                    <I d={ICON_DOWNLOAD} s={14} /> Download PDF
                                </button>
                                <span className="emb-hint">{result.summary.totalStitches.toLocaleString()} estimated stitches · {fmt(result.summary.physicalWidthCm)} × {fmt(result.summary.physicalHeightCm)} cm</span>
                            </div>
                            {result.summary.layers.length > 0 && (
                                <ul className="emb-match-list" aria-label="Stitch estimates">
                                    {result.summary.layers.map((layer, index) => (
                                        <li key={`${layer.filename}-${index}`} className="emb-match-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                                            <div className="emb-match-main">
                                                <div className="emb-match-title"><strong>{layer.name}</strong><span>{fmt(layer.w_cm)} × {fmt(layer.h_cm)} cm at {fmt(layer.x_cm)}, {fmt(layer.y_cm)} cm</span></div>
                                                <div className="emb-hint">{STITCH_STYLES.find((s) => s.id === layer.stitch_style)?.label || layer.stitch_style} · {layer.density} · coverage {Math.round(layer.coverage * 100)}%</div>
                                            </div>
                                            <strong style={{ fontSize: '0.9rem' }}>{Number(layer.stitches).toLocaleString()}</strong>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </section>
            </div>
            <input {...inputProps} />
        </div>
    );
}
