import { useEffect, useMemo, useState } from 'react';
import { I } from '../shared/StudioIcons';
import { apiFetch, cacheMediaFromResponse, forceDownload, mediaUrl } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import ModelLoadingBar from '../shared/ModelLoadingBar';
import { useImageDropzone } from '../shared/useImageDropzone';
import { useResultUrls } from '../../../stores/resultUrls';
import {
    EMBROIDERY_FABRICS,
    EMBROIDERY_PRODUCTS,
    EMBROIDERY_TECHNIQUES,
    MOCKUP_BACKGROUNDS,
    MOCKUP_SHOTS,
    productById,
    suitability,
} from '../shared/embroideryMockups';
import '../../../styles/tools/embroidery.css';

const ICON_DOWNLOAD = 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3';
const GROUPS = ['Apparel', 'Accessories', 'Home'];

/**
 * Embroidery Mockups: show a flattened placement as real embroidery on one zone of a product,
 * with a technique-by-product-by-fabric suitability guide. Placement-aware, not all-over.
 */
export default function EmbroideryMockupsTool(props) {
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

    const [source, setSource] = useState(null); // { filename, url, name, fileAccessToken }
    const [motifs, setMotifs] = useState([]);
    const [productId, setProductId] = useState('saree');
    const [zone, setZone] = useState('pallu');
    const [technique, setTechnique] = useState('zari');
    const [fabric, setFabric] = useState('silk');
    const [background, setBackground] = useState('studio');
    const [shot, setShot] = useState('editorial');
    const [customPrompt, setCustomPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [results, setResults] = useState([]);

    const cost = creditPricing?.embroideryMockup || 67;
    const remainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const uploadReady = Boolean(uploaded?.filename) && uploadStatus === 'ready';
    const product = productById(productId);
    const guide = suitability(technique, productId, fabric);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await apiFetch('/api/motifs', {}, currentToken);
                if (cancelled || !data.success) return;
                (data.motifs || []).forEach((motif) => cacheMediaFromResponse({ filename: motif.filename, fileAccessToken: motif.fileAccessToken }));
                setMotifs(data.motifs || []);
            } catch {
                // The library is optional here; uploads and the last placement still work.
            }
        })();
        return () => { cancelled = true; };
    }, [currentToken]);

    const zones = product?.zones || [];
    const effectiveZone = zones.includes(zone) ? zone : zones[0] || '';

    const groupedProducts = useMemo(() => GROUPS.map((group) => ({ group, items: EMBROIDERY_PRODUCTS.filter((item) => item.group === group) })), []);

    const chooseProduct = (id) => {
        setProductId(id);
        const next = productById(id);
        if (next && !next.zones.includes(zone)) setZone(next.zones[0]);
    };

    const generate = () => {
        if (!source?.filename) {
            setError('Choose a source first: your latest placement, an upload, or a motif.');
            return;
        }
        if (!effectiveZone) {
            setError('Pick a placement zone.');
            return;
        }
        if (remainingCredits < cost) {
            setError(`An embroidery mockup needs ${cost} credits, but you have ${remainingCredits} remaining.`);
            return;
        }
        setIsGenerating(true);
        setError('');
        const payload = {
            projectId: activeProject?.id,
            userId: user?.id,
            sourceFilename: source.filename,
            productType: productId,
            zone: effectiveZone,
            technique,
            fabric,
            background,
            shotStyle: shot,
            customPrompt: customPrompt.trim(),
        };
        const trigger = async () => {
            try {
                const data = await apiFetch('/api/embroidery/mockup', { method: 'POST', body: JSON.stringify(payload) }, currentToken);
                if (!data.success) throw new Error(data.error || 'Mockup failed');
                cacheMediaFromResponse(data);
                updateCreditsFromResponse?.(data);
                setResults((prev) => [data, ...prev].slice(0, 12));
                setNotice?.(`Mockup ready: ${product?.label || productId} · ${effectiveZone}`);
                return { url: data.mockupUrl, fileAccessToken: data.fileAccessToken };
            } finally {
                setIsGenerating(false);
            }
        };
        if (typeof addBgTask === 'function') {
            addBgTask('emb-mockups', `Embroidery mockup: ${product?.label || productId} (${effectiveZone})`, source.filename, trigger, {
                modelId: 'google/nano-banana-2',
            });
        } else {
            trigger().catch((error) => setError(error.message || 'Mockup failed'));
        }
    };

    return (
        <div {...pasteProps} className="emb-tool">
            <header className="emb-tool-head">
                <div>
                    <h1>Embroidery Mockups</h1>
                    <p>Show a placement as real embroidery on one zone of a product, with the rest of the fabric left plain. Pick the product, the zone, the technique and the fabric, and check the suitability guide before you spend credits.</p>
                </div>
            </header>

            <div className="emb-grid-2">
                <section className="emb-panel" aria-label="Mockup settings">
                    <h2 className="emb-panel-title"><strong>1. Source design</strong><span>{source ? source.name : 'none chosen'}</span></h2>
                    <div className="emb-field-row">
                        {lastPlacement && (
                            <button type="button" className={`emb-btn is-small${source?.filename === lastPlacement.filename ? ' is-primary' : ''}`} onClick={() => setSource({ filename: lastPlacement.filename, url: lastPlacement.url, name: 'Latest placement', fileAccessToken: lastPlacement.fileAccessToken })}>
                                Use latest placement
                            </button>
                        )}
                        {!lastPlacement && (
                            <button type="button" className="emb-btn is-small" onClick={() => setTool?.('emb-placement')}>Open Placement Studio</button>
                        )}
                        {uploadReady && (
                            <button type="button" className={`emb-btn is-small${source?.filename === uploaded.filename ? ' is-primary' : ''}`} onClick={() => setSource({ filename: uploaded.filename, url: `/uploads/${uploaded.filename}`, name: uploaded.originalName || 'Upload' })}>
                                Use uploaded design
                            </button>
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
                        <ImageDropzone
                            variant="compact"
                            title="Upload a flattened design"
                            description="Or use your latest Placement Studio flatten"
                            onFile={handlePreUpload}
                            onInvalidFile={onUploadInvalid}
                            onPasteSuccess={onUploadPaste}
                            uploadStatus={uploadStatus}
                        />
                    )}
                    {motifs.length > 0 && (
                        <>
                            <p className="emb-hint">Or mock up a single motif from your library:</p>
                            <div className="emb-motif-picker" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
                                {motifs.slice(0, 12).map((motif) => (
                                    <button key={motif.id} type="button" className={`emb-motif-pick${source?.filename === motif.filename ? ' is-active' : ''}`} onClick={() => setSource({ filename: motif.filename, url: motif.url, name: motif.name, fileAccessToken: motif.fileAccessToken })} title={motif.name} aria-pressed={source?.filename === motif.filename}>
                                        <span className="emb-motif-thumb"><MediaImg src={motif.url} alt="" token={currentToken} accessToken={motif.fileAccessToken} loading="lazy" /></span>
                                        <span className="emb-motif-name">{motif.name}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    <h2 className="emb-panel-title"><strong>2. Product and zone</strong></h2>
                    {groupedProducts.map(({ group, items }) => (
                        <div key={group} className="emb-field">
                            <label>{group}</label>
                            <div className="emb-product-grid">
                                {items.map((item) => (
                                    <button key={item.id} type="button" className={`emb-product-card${productId === item.id ? ' is-active' : ''}`} onClick={() => chooseProduct(item.id)} aria-pressed={productId === item.id}>
                                        <img src={`/products/${item.id}.png`} alt="" loading="lazy" />
                                        <span>{item.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div className="emb-chips" role="tablist" aria-label="Placement zone">
                        {zones.map((item) => (
                            <button key={item} type="button" role="tab" aria-selected={effectiveZone === item} className={`emb-chip${effectiveZone === item ? ' is-active' : ''}`} onClick={() => setZone(item)}>{item}</button>
                        ))}
                    </div>

                    <h2 className="emb-panel-title"><strong>3. Technique and fabric</strong></h2>
                    <div className="emb-field-row">
                        <select className="emb-select" value={technique} onChange={(e) => setTechnique(e.target.value)} aria-label="Technique" style={{ flex: 1 }}>
                            {EMBROIDERY_TECHNIQUES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                        <select className="emb-select" value={fabric} onChange={(e) => setFabric(e.target.value)} aria-label="Fabric" style={{ flex: 1 }}>
                            {EMBROIDERY_FABRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                    </div>
                    <div className={`emb-suit is-${guide.level}`} role="status">
                        <strong>{guide.label}</strong>
                        <span>{guide.note}</span>
                    </div>

                    <h2 className="emb-panel-title"><strong>4. Shot</strong></h2>
                    <div className="emb-field-row">
                        <select className="emb-select" value={background} onChange={(e) => setBackground(e.target.value)} aria-label="Background">
                            {MOCKUP_BACKGROUNDS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <select className="emb-select" value={shot} onChange={(e) => setShot(e.target.value)} aria-label="Shot style">
                            {MOCKUP_SHOTS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </div>
                    <input className="emb-input" placeholder="Art direction (optional), e.g. warm evening light" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} aria-label="Art direction" />
                    <button type="button" className="emb-btn is-primary" onClick={generate} disabled={isGenerating || !source}>
                        {isGenerating ? 'Rendering…' : `Generate mockup (${cost} credits)`}
                    </button>
                </section>

                <section className="emb-panel" aria-label="Mockups">
                    <h2 className="emb-panel-title"><strong>Mockups</strong><span>{results.length ? `${results.length} this session` : ''}</span></h2>
                    {isGenerating && (
                        <ModelLoadingBar active modelId="google/nano-banana-2" label="Rendering embroidery on the product…" accent="#f43f5e" />
                    )}
                    {results.length === 0 && !isGenerating ? (
                        <div className="emb-empty">
                            <strong>No mockups yet</strong>
                            Your renders appear here with the product, zone and technique used.
                        </div>
                    ) : (
                        <div className="emb-gallery">
                            {results.map((result) => (
                                <article key={result.filename} className="emb-motif-card">
                                    <div className="emb-gallery-thumb"><MediaImg src={result.mockupUrl} alt={`${result.productType} ${result.zone}`} token={currentToken} accessToken={result.fileAccessToken} /></div>
                                    <div className="emb-motif-body">
                                        <div className="emb-motif-name">{productById(result.productType)?.label || result.productType} · {result.zone}</div>
                                        <div className="emb-motif-meta"><span className="emb-technique">{EMBROIDERY_TECHNIQUES.find((t) => t.id === result.technique)?.label || result.technique}</span><span>{result.fabric}</span></div>
                                    </div>
                                    <div className="emb-motif-actions">
                                        <button type="button" className="emb-btn is-small" onClick={(e) => forceDownload(e, mediaUrl(result.mockupUrl), result.filename, currentToken)}><I d={ICON_DOWNLOAD} s={13} /> Download</button>
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
