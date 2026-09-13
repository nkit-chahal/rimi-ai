import { useEffect, useState } from 'react';
import { I } from '../shared/StudioIcons';
import { apiFetch, cacheMediaFromResponse, forceDownload, mediaUrl } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import ModelLoadingBar from '../shared/ModelLoadingBar';
import { useImageDropzone } from '../shared/useImageDropzone';
import { useResultUrls } from '../../../stores/resultUrls';
import '../../../styles/tools/embroidery.css';

const ICON_MOVE = 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20';
const ICON_DOWNLOAD = 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3';
const ICON_SEND = 'M5 12h14M13 6l6 6-6 6';

const FALLBACK_STYLES = [
    { id: 'satin', label: 'Satin stitch', blurb: 'Lettering, borders and shapes under 1 cm wide.', density: 900 },
    { id: 'fill', label: 'Tatami fill', blurb: 'Large areas and solid backgrounds.', density: 1200 },
    { id: 'chain', label: 'Chain stitch', blurb: 'Outlines and folk motifs.', density: 500 },
    { id: 'french_knot', label: 'French knots', blurb: 'Flower centres and textured fills.', density: 250 },
    { id: 'zardozi', label: 'Zardozi', blurb: 'Bridal and festive borders on silk and velvet.', density: 700 },
    { id: 'aari', label: 'Aari (tambour)', blurb: 'Fine all-over work on sarees and blouses.', density: 550 },
    { id: 'kantha', label: 'Kantha running stitch', blurb: 'Quilted, hand-made look.', density: 200 },
    { id: 'cross', label: 'Cross stitch', blurb: 'Geometric and folk designs.', density: 400 },
];
const FINISH_LABELS = { cotton: 'Matte cotton', rayon: 'Glossy rayon', metallic: 'Metallic' };
const DENSITY_LABELS = { light: 'Light', medium: 'Medium', dense: 'Dense' };
const DIRECTION_LABELS = { follow: 'Follow shapes', horizontal: 'Horizontal', diagonal: 'Diagonal' };

/**
 * Stitch Styles: an AI render pass that turns a flat motif or a whole placement into realistic
 * embroidery in a chosen stitch style. Motif renders keep transparency and go back into the library.
 */
export default function StitchStylesTool(props) {
    const {
        uploaded, preview, uploadStatus, activeProject, user, currentToken, creditPricing,
        setError, setNotice, setTool, addBgTask, updateCreditsFromResponse,
        handlePreUpload, onUploadInvalid, onUploadPaste,
    } = props;

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });
    const lastPlacement = useResultUrls((state) => state.lastPlacementResult);
    const setPendingMotif = useResultUrls((state) => state.setPendingMotif);
    const setLastPlacementResult = useResultUrls((state) => state.setLastPlacementResult);

    const [catalogue, setCatalogue] = useState({ styles: FALLBACK_STYLES, finishes: Object.keys(FINISH_LABELS), densities: Object.keys(DENSITY_LABELS), directions: Object.keys(DIRECTION_LABELS) });
    const [motifs, setMotifs] = useState([]);
    const [source, setSource] = useState(null); // { filename, url, name, fileAccessToken, suggestedMode }
    const [mode, setMode] = useState('design');
    const [style, setStyle] = useState('satin');
    const [finish, setFinish] = useState('rayon');
    const [density, setDensity] = useState('medium');
    const [direction, setDirection] = useState('follow');
    const [saveToLibrary, setSaveToLibrary] = useState(true);
    const [name, setName] = useState('');
    const [isRendering, setIsRendering] = useState(false);
    const [results, setResults] = useState([]);

    const motifCost = creditPricing?.stitchRenderMotif || 35;
    const designCost = creditPricing?.stitchRenderDesign || 67;
    const cost = mode === 'motif' ? motifCost : designCost;
    const remainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const uploadReady = Boolean(uploaded?.filename) && uploadStatus === 'ready';

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [styles, library] = await Promise.all([
                    apiFetch('/api/stitch/styles', {}, currentToken),
                    apiFetch('/api/motifs', {}, currentToken),
                ]);
                if (cancelled) return;
                if (styles.success && styles.styles?.length) {
                    setCatalogue({ styles: styles.styles, finishes: styles.finishes, densities: styles.densities, directions: styles.directions });
                }
                if (library.success) {
                    (library.motifs || []).forEach((motif) => cacheMediaFromResponse({ filename: motif.filename, fileAccessToken: motif.fileAccessToken }));
                    setMotifs(library.motifs || []);
                }
            } catch {
                // Fallback catalogue keeps the tool usable.
            }
        })();
        return () => { cancelled = true; };
    }, [currentToken]);

    const chooseSource = (next) => {
        setSource(next);
        if (next?.suggestedMode) setMode(next.suggestedMode);
    };

    const render = () => {
        if (!source?.filename) {
            setError('Choose a source first: a placement, an upload, or a library motif.');
            return;
        }
        if (remainingCredits < cost) {
            setError(`This render needs ${cost} credits, but you have ${remainingCredits} remaining.`);
            return;
        }
        setIsRendering(true);
        setError('');
        const payload = {
            projectId: activeProject?.id,
            userId: user?.id,
            sourceFilename: source.filename,
            mode,
            style,
            finish,
            density,
            direction,
            saveToLibrary: mode === 'motif' && saveToLibrary,
            name: name.trim() || undefined,
        };
        const trigger = async () => {
            try {
                const data = await apiFetch('/api/stitch/render', { method: 'POST', body: JSON.stringify(payload) }, currentToken);
                if (!data.success) throw new Error(data.error || 'Stitch render failed');
                cacheMediaFromResponse(data);
                if (data.motif) cacheMediaFromResponse({ filename: data.motif.filename, fileAccessToken: data.motif.fileAccessToken });
                updateCreditsFromResponse?.(data);
                setResults((prev) => [{ ...data, sourceName: source.name }, ...prev].slice(0, 12));
                if (data.motif) setMotifs((prev) => [data.motif, ...prev]);
                setNotice?.(`${catalogue.styles.find((s) => s.id === data.style)?.label || data.style} render ready`);
                return { url: data.resultUrl, fileAccessToken: data.fileAccessToken };
            } finally {
                setIsRendering(false);
            }
        };
        if (typeof addBgTask === 'function') {
            addBgTask('emb-stitches', `Stitch render: ${style} (${mode})`, source.filename, trigger, {
                modelId: mode === 'motif' ? 'qwen/qwen-image-edit' : 'google/nano-banana-2',
            });
        } else {
            trigger().catch((error) => setError(error.message || 'Stitch render failed'));
        }
    };

    const placeResult = (result) => {
        const motif = result.motif || { id: null, name: `${result.style} render`, filename: result.filename, url: result.resultUrl, fileAccessToken: result.fileAccessToken, width: result.width, height: result.height };
        setPendingMotif?.(motif);
        setTool?.('emb-placement');
    };

    const sendToMockups = (result) => {
        setLastPlacementResult?.({ url: result.resultUrl, filename: result.filename, fileAccessToken: result.fileAccessToken, width: result.width, height: result.height });
        setTool?.('emb-mockups');
    };

    return (
        <div {...pasteProps} className="emb-tool">
            <header className="emb-tool-head">
                <div>
                    <h1>Stitch Styles</h1>
                    <p>Turn a flat motif or a whole placement into realistic embroidery. Pick the stitch, thread finish, density and direction; the render keeps your composition and only changes the surface into thread.</p>
                </div>
            </header>

            <div className="emb-grid-2">
                <section className="emb-panel" aria-label="Render settings">
                    <h2 className="emb-panel-title"><strong>1. Source</strong><span>{source ? source.name : 'none chosen'}</span></h2>
                    <div className="emb-field-row">
                        {lastPlacement ? (
                            <button type="button" className={`emb-btn is-small${source?.filename === lastPlacement.filename ? ' is-primary' : ''}`} onClick={() => chooseSource({ filename: lastPlacement.filename, url: lastPlacement.url, name: 'Latest placement', fileAccessToken: lastPlacement.fileAccessToken, suggestedMode: 'design' })}>
                                Use latest placement
                            </button>
                        ) : (
                            <button type="button" className="emb-btn is-small" onClick={() => setTool?.('emb-placement')}>Open Placement Studio</button>
                        )}
                        {uploadReady && (
                            <button type="button" className={`emb-btn is-small${source?.filename === uploaded.filename ? ' is-primary' : ''}`} onClick={() => chooseSource({ filename: uploaded.filename, url: `/uploads/${uploaded.filename}`, name: uploaded.originalName || 'Upload', suggestedMode: 'design' })}>
                                Use uploaded image
                            </button>
                        )}
                    </div>
                    {preview ? (
                        <div className="emb-upload-thumb">
                            <img src={preview} alt="Uploaded design" />
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <strong>{uploaded?.originalName || 'Uploaded image'}</strong>
                                <UploadStatusBadge status={uploadStatus} />
                            </div>
                            <button type="button" className="emb-btn is-small" onClick={openFilePicker}>Replace</button>
                        </div>
                    ) : (
                        <ImageDropzone
                            variant="compact"
                            title="Upload a design or motif"
                            description="Transparent PNGs render as single motifs"
                            onFile={handlePreUpload}
                            onInvalidFile={onUploadInvalid}
                            onPasteSuccess={onUploadPaste}
                            uploadStatus={uploadStatus}
                        />
                    )}
                    {motifs.length > 0 && (
                        <>
                            <p className="emb-hint">Or render a library motif (keeps transparency):</p>
                            <div className="emb-motif-picker" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
                                {motifs.slice(0, 12).map((motif) => (
                                    <button key={motif.id} type="button" className={`emb-motif-pick${source?.filename === motif.filename ? ' is-active' : ''}`} onClick={() => chooseSource({ filename: motif.filename, url: motif.url, name: motif.name, fileAccessToken: motif.fileAccessToken, suggestedMode: 'motif' })} title={motif.name} aria-pressed={source?.filename === motif.filename}>
                                        <span className="emb-motif-thumb"><MediaImg src={motif.url} alt="" token={currentToken} accessToken={motif.fileAccessToken} loading="lazy" /></span>
                                        <span className="emb-motif-name">{motif.name}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <div className="emb-chips" role="tablist" aria-label="Render mode">
                        <button type="button" role="tab" aria-selected={mode === 'motif'} className={`emb-chip${mode === 'motif' ? ' is-active' : ''}`} onClick={() => setMode('motif')}>Single motif · {motifCost} credits</button>
                        <button type="button" role="tab" aria-selected={mode === 'design'} className={`emb-chip${mode === 'design' ? ' is-active' : ''}`} onClick={() => setMode('design')}>Whole design · {designCost} credits</button>
                    </div>
                    <p className="emb-hint">{mode === 'motif' ? 'Single motif keeps the transparent background so the render can be placed again.' : 'Whole design re-renders a flattened placement in place, ready for mockups.'}</p>

                    <h2 className="emb-panel-title"><strong>2. Stitch style</strong></h2>
                    <div className="emb-style-grid" role="radiogroup" aria-label="Stitch style">
                        {catalogue.styles.map((item) => (
                            <button key={item.id} type="button" role="radio" aria-checked={style === item.id} className={`emb-style-card${style === item.id ? ' is-active' : ''}`} onClick={() => setStyle(item.id)}>
                                <strong>{item.label}</strong>
                                <span>{item.blurb}</span>
                                <small>~{item.density} st/cm²</small>
                            </button>
                        ))}
                    </div>
                    <div className="emb-field-row">
                        <select className="emb-select" value={finish} onChange={(e) => setFinish(e.target.value)} aria-label="Thread finish">
                            {catalogue.finishes.map((item) => <option key={item} value={item}>{FINISH_LABELS[item] || item}</option>)}
                        </select>
                        <select className="emb-select" value={density} onChange={(e) => setDensity(e.target.value)} aria-label="Density">
                            {catalogue.densities.map((item) => <option key={item} value={item}>{DENSITY_LABELS[item] || item}</option>)}
                        </select>
                        <select className="emb-select" value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Stitch direction">
                            {catalogue.directions.map((item) => <option key={item} value={item}>{DIRECTION_LABELS[item] || item}</option>)}
                        </select>
                    </div>
                    {mode === 'motif' && (
                        <div className="emb-field-row">
                            <label className="emb-checkbox">
                                <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
                                Save the render to my Motif Library
                            </label>
                            <input className="emb-input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Render name" style={{ flex: 1, minWidth: 140 }} />
                        </div>
                    )}
                    <button type="button" className="emb-btn is-primary" onClick={render} disabled={isRendering || !source}>
                        {isRendering ? 'Rendering…' : `Render embroidery (${cost} credits)`}
                    </button>
                </section>

                <section className="emb-panel" aria-label="Renders">
                    <h2 className="emb-panel-title"><strong>Renders</strong><span>{results.length ? `${results.length} this session` : ''}</span></h2>
                    {isRendering && <ModelLoadingBar active modelId={mode === 'motif' ? 'qwen/qwen-image-edit' : 'google/nano-banana-2'} label="Stitching…" accent="#f43f5e" />}
                    {results.length === 0 && !isRendering ? (
                        <div className="emb-empty">
                            <strong>No renders yet</strong>
                            Renders appear here. Motif renders can be placed; design renders can go straight to mockups.
                        </div>
                    ) : (
                        <div className="emb-gallery">
                            {results.map((result) => (
                                <article key={result.filename} className="emb-motif-card">
                                    <div className="emb-gallery-thumb"><MediaImg src={result.resultUrl} alt={`${result.style} render`} token={currentToken} accessToken={result.fileAccessToken} /></div>
                                    <div className="emb-motif-body">
                                        <div className="emb-motif-name">{catalogue.styles.find((s) => s.id === result.style)?.label || result.style} · {result.mode}</div>
                                        <div className="emb-motif-meta"><span>{result.sourceName}</span><span>{result.width}×{result.height}</span></div>
                                    </div>
                                    <div className="emb-motif-actions">
                                        {result.mode === 'motif' ? (
                                            <button type="button" className="emb-btn is-small is-primary" onClick={() => placeResult(result)}><I d={ICON_MOVE} s={13} /> Place</button>
                                        ) : (
                                            <button type="button" className="emb-btn is-small is-primary" onClick={() => sendToMockups(result)}><I d={ICON_SEND} s={13} /> Mockups</button>
                                        )}
                                        <button type="button" className="emb-btn is-small" onClick={(e) => forceDownload(e, mediaUrl(result.resultUrl), result.filename, currentToken)} aria-label="Download render"><I d={ICON_DOWNLOAD} s={13} /></button>
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
