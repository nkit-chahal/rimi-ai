import { useEffect, useState } from 'react';
import { I } from '../shared/StudioIcons';
import { apiFetch } from '../shared/helpers';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import { useImageDropzone } from '../shared/useImageDropzone';
import {
    deltaEQuality,
    normalizeHex,
    parseShadeCardFile,
    threadPaletteToCsv,
} from '../shared/shadeCardImport';
import '../../../styles/tools/embroidery.css';

const MAX_SOURCE_COLORS = 24;
const ICON_TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';
const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_DOWNLOAD = 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3';
const ICON_ARROW = 'M5 12h14M13 6l6 6-6 6';

function downloadTextFile(filename, text, mime = 'text/csv') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Thread Shades: match artwork colours to a thread (or Pantone) shade card the way
 * print designers use Pantone codes, then save the thread list to the project.
 */
export default function ThreadShadesTool(props) {
    const {
        uploaded, preview, uploadStatus, isUploading, activeProject, currentToken,
        setError, setNotice, handlePreUpload, onUploadInvalid, onUploadPaste,
    } = props;

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const [cards, setCards] = useState([]);
    const [cardsVersion, setCardsVersion] = useState(0);
    const [cardId, setCardId] = useState('');
    const [sources, setSources] = useState([]);           // [{ hex, weight?, label? }]
    const [matchState, setMatchState] = useState({ cardId: null, byHex: {} });
    const [chosen, setChosen] = useState({});             // hex -> index into matches
    const [isMatching, setIsMatching] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [numColors, setNumColors] = useState(6);
    const [manualHex, setManualHex] = useState('#c8102e');
    const [pantoneQuery, setPantoneQuery] = useState('');
    const [pantoneColors, setPantoneColors] = useState(null);
    const [paletteName, setPaletteName] = useState('');
    const [savedPalettes, setSavedPalettes] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importDraft, setImportDraft] = useState({ name: '', brand: '', kind: 'thread', entries: [], errors: [], filename: '' });
    const [isImporting, setIsImporting] = useState(false);

    const uploadReady = Boolean(uploaded?.filename) && uploadStatus === 'ready';
    const activeCard = cards.find((card) => card.id === cardId) || null;
    // Matches are only valid for the card they were computed on.
    const matches = matchState.cardId === cardId ? matchState.byHex : {};
    const refreshCards = () => setCardsVersion((version) => version + 1);

    // Shade cards: built-in plus this user's imports.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await apiFetch('/api/shade-cards', {}, currentToken);
                if (cancelled) return;
                if (!data.success) throw new Error(data.error || 'Could not load shade cards');
                const list = data.cards || [];
                setCards(list);
                setCardId((current) => {
                    if (current && list.some((card) => card.id === current)) return current;
                    const thread = list.find((card) => card.kind === 'thread');
                    return thread?.id || list[0]?.id || '';
                });
            } catch (error) {
                if (!cancelled) setError(error.message || 'Could not load shade cards');
            }
        })();
        return () => { cancelled = true; };
    }, [currentToken, cardsVersion, setError]);

    // Saved thread palettes for the active project.
    useEffect(() => {
        if (!activeProject?.id) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const data = await apiFetch(`/api/thread-palettes?projectId=${activeProject.id}`, {}, currentToken);
                if (!cancelled && data.success) setSavedPalettes(data.palettes || []);
            } catch {
                // Saved palettes are secondary; the matcher still works without them.
            }
        })();
        return () => { cancelled = true; };
    }, [activeProject?.id, currentToken]);

    // Re-match whenever the colours or the card change. Debounced so typing a hex does not spam the API.
    useEffect(() => {
        if (!cardId || sources.length === 0) return undefined;
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setIsMatching(true);
            try {
                const data = await apiFetch('/api/shade-cards/match', {
                    method: 'POST',
                    body: JSON.stringify({ cardId, colors: sources.map((s) => s.hex), topN: 3 }),
                }, currentToken);
                if (cancelled) return;
                if (!data.success) throw new Error(data.error || 'Matching failed');
                const byHex = {};
                data.results.forEach((result) => { byHex[result.hex] = result.matches || []; });
                setMatchState({ cardId, byHex });
                setChosen({});
            } catch (error) {
                if (!cancelled) setError(error.message || 'Matching failed');
            } finally {
                if (!cancelled) setIsMatching(false);
            }
        }, 250);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [cardId, sources, currentToken, setError]);

    const addSources = (incoming) => {
        setSources((prev) => {
            const seen = new Set(prev.map((s) => s.hex));
            const next = [...prev];
            incoming.forEach((item) => {
                const hex = normalizeHex(item.hex);
                if (hex && !seen.has(hex) && next.length < MAX_SOURCE_COLORS) {
                    seen.add(hex);
                    next.push({ ...item, hex });
                }
            });
            return next;
        });
    };

    const removeSource = (hex) => setSources((prev) => prev.filter((s) => s.hex !== hex));

    const extractFromImage = async () => {
        if (!uploadReady) {
            if (isUploading) setError('Please wait, the image is still uploading.');
            else setError('Upload an artwork image first (JPG, PNG or WEBP).');
            return;
        }
        setIsExtracting(true);
        try {
            const data = await apiFetch('/api/extract-palette', {
                method: 'POST',
                body: JSON.stringify({ filename: uploaded.filename, numColors }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not extract colours');
            setSources(data.palette.map((p) => ({ hex: normalizeHex(p.hex), weight: p.weight, label: 'Artwork' })).filter((p) => p.hex));
        } catch (error) {
            setError(error.message || 'Could not extract colours');
        } finally {
            setIsExtracting(false);
        }
    };

    const addManual = () => {
        const hex = normalizeHex(manualHex);
        if (!hex) {
            setError('Enter a hex colour like #c8102e');
            return;
        }
        addSources([{ hex, label: 'Manual' }]);
    };

    const addFromPantone = async () => {
        const query = pantoneQuery.trim().toLowerCase();
        if (!query) return;
        let list = pantoneColors;
        if (!list) {
            try {
                const data = await apiFetch('/api/pantone-colors', {}, currentToken);
                list = data.colors || [];
                setPantoneColors(list);
            } catch {
                setError('Could not load the Pantone library');
                return;
            }
        }
        const hit = list.find((c) => c.code?.toLowerCase() === query)
            || list.find((c) => c.code?.toLowerCase().startsWith(query) || c.name?.toLowerCase().includes(query));
        if (!hit) {
            setError(`No Pantone TCX colour matches "${pantoneQuery.trim()}"`);
            return;
        }
        addSources([{ hex: hit.hex, label: `Pantone ${hit.code}` }]);
        setPantoneQuery('');
    };

    const chosenEntries = sources.map((source) => {
        const options = matches[source.hex] || [];
        const pick = options[chosen[source.hex] ?? 0];
        return pick ? { sourceHex: source.hex, code: pick.code, name: pick.name, hex: pick.hex, deltaE: pick.deltaE } : null;
    }).filter(Boolean);

    const savePalette = async () => {
        if (!activeProject?.id || !chosenEntries.length) return;
        const name = paletteName.trim() || `${activeCard?.name || 'Thread'} palette`;
        setIsSaving(true);
        try {
            const data = await apiFetch('/api/thread-palettes', {
                method: 'POST',
                body: JSON.stringify({ projectId: activeProject.id, name, cardId, entries: chosenEntries }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not save palette');
            setSavedPalettes((prev) => [data.palette, ...prev]);
            setPaletteName('');
            setNotice?.(`Saved "${name}" to ${activeProject.name || 'the project'}`);
        } catch (error) {
            setError(error.message || 'Could not save palette');
        } finally {
            setIsSaving(false);
        }
    };

    const deletePalette = async (paletteId) => {
        try {
            const data = await apiFetch(`/api/thread-palettes/${paletteId}`, { method: 'DELETE' }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not delete palette');
            setSavedPalettes((prev) => prev.filter((p) => p.id !== paletteId));
        } catch (error) {
            setError(error.message || 'Could not delete palette');
        }
    };

    const exportCsv = () => {
        if (!chosenEntries.length) return;
        const safeName = (paletteName.trim() || activeCard?.name || 'thread-palette').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
        downloadTextFile(`${safeName}.csv`, threadPaletteToCsv(chosenEntries));
    };

    const onImportFile = async (file) => {
        if (!file) return;
        const text = await file.text();
        const parsed = parseShadeCardFile(file.name, text);
        setImportDraft((draft) => ({
            ...draft,
            filename: file.name,
            name: draft.name || file.name.replace(/\.[^.]+$/, ''),
            entries: parsed.entries,
            errors: parsed.errors,
        }));
    };

    const createCard = async () => {
        if (!importDraft.entries.length) {
            setError('Choose a CSV or JSON file with shade codes and hex colours first.');
            return;
        }
        setIsImporting(true);
        try {
            const data = await apiFetch('/api/shade-cards', {
                method: 'POST',
                body: JSON.stringify({
                    name: importDraft.name || importDraft.filename,
                    brand: importDraft.brand,
                    kind: importDraft.kind,
                    entries: importDraft.entries,
                }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not import shade card');
            refreshCards();
            setCardId(data.card.id);
            setImportOpen(false);
            setImportDraft({ name: '', brand: '', kind: 'thread', entries: [], errors: [], filename: '' });
            setNotice?.(`Imported "${data.card.name}" with ${data.card.count} shades`);
        } catch (error) {
            setError(error.message || 'Could not import shade card');
        } finally {
            setIsImporting(false);
        }
    };

    const deleteCard = async () => {
        if (!activeCard || activeCard.builtIn) return;
        try {
            const data = await apiFetch(`/api/shade-cards/${activeCard.id}`, { method: 'DELETE' }, currentToken);
            if (!data.success) throw new Error(data.error || 'Could not delete shade card');
            refreshCards();
        } catch (error) {
            setError(error.message || 'Could not delete shade card');
        }
    };

    return (
        <div {...pasteProps} className="emb-tool">
            <header className="emb-tool-head">
                <div>
                    <h1>Thread Shades</h1>
                    <p>Match artwork colours to thread shade numbers the way Pantone codes work for print. Extract colours from a design, or add them by hand, then save the thread list to the project.</p>
                </div>
                <div className="emb-head-actions">
                    <label className="emb-field" style={{ minWidth: 220 }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Shade card</span>
                        <select className="emb-select" value={cardId} onChange={(e) => setCardId(e.target.value)} aria-label="Shade card">
                            {cards.map((card) => (
                                <option key={card.id} value={card.id}>{card.name} ({card.count})</option>
                            ))}
                        </select>
                    </label>
                    <button type="button" className="emb-btn" onClick={() => setImportOpen((v) => !v)}>
                        <I d={ICON_PLUS} s={14} /> Import card
                    </button>
                    {activeCard && !activeCard.builtIn && (
                        <button type="button" className="emb-btn is-danger" onClick={deleteCard} title="Delete this custom card">
                            <I d={ICON_TRASH} s={14} /> Delete card
                        </button>
                    )}
                </div>
            </header>

            {activeCard?.note && <div className="emb-note">{activeCard.note}</div>}

            {importOpen && (
                <section className="emb-panel" aria-label="Import shade card">
                    <h2 className="emb-panel-title"><strong>Import a supplier shade card</strong><span>CSV or JSON</span></h2>
                    <p className="emb-hint">Columns: shade code, name (optional) and hex colour, in any order with a header row. Imported cards are private to your account.</p>
                    <div className="emb-field-row">
                        <label className="emb-btn">
                            Choose file
                            <input type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => onImportFile(e.target.files?.[0])} />
                        </label>
                        <input className="emb-input" placeholder="Card name" value={importDraft.name} onChange={(e) => setImportDraft((d) => ({ ...d, name: e.target.value }))} aria-label="Card name" />
                        <input className="emb-input" placeholder="Brand" value={importDraft.brand} onChange={(e) => setImportDraft((d) => ({ ...d, brand: e.target.value }))} aria-label="Brand" />
                        <select className="emb-select" value={importDraft.kind} onChange={(e) => setImportDraft((d) => ({ ...d, kind: e.target.value }))} aria-label="Card kind">
                            <option value="thread">Thread</option>
                            <option value="yarn">Yarn</option>
                            <option value="custom">Other</option>
                        </select>
                        <button type="button" className="emb-btn is-primary" onClick={createCard} disabled={isImporting || !importDraft.entries.length}>
                            {isImporting ? 'Importing…' : `Create card${importDraft.entries.length ? ` (${importDraft.entries.length})` : ''}`}
                        </button>
                    </div>
                    {importDraft.filename && (
                        <p className="emb-hint">
                            {importDraft.filename}: {importDraft.entries.length} shades ready{importDraft.errors.length ? `, ${importDraft.errors.length} lines skipped` : ''}.
                            {importDraft.errors.length > 0 && ` First problem: ${importDraft.errors[0]}`}
                        </p>
                    )}
                </section>
            )}

            <div className="emb-grid-2">
                <section className="emb-panel" aria-label="Source colours">
                    <h2 className="emb-panel-title"><strong>Source colours</strong><span>{sources.length} / {MAX_SOURCE_COLORS}</span></h2>

                    {preview ? (
                        <div className="emb-preview">
                            <img src={preview} alt="Uploaded artwork" />
                            <div className="emb-preview-actions">
                                <UploadStatusBadge status={uploadStatus} />
                                <button type="button" className="emb-btn is-small" onClick={openFilePicker}>Replace</button>
                            </div>
                        </div>
                    ) : (
                        <ImageDropzone
                            variant="compact"
                            title="Upload artwork"
                            description="Drag, paste or click to pick colours from a design"
                            onFile={handlePreUpload}
                            onInvalidFile={onUploadInvalid}
                            onPasteSuccess={onUploadPaste}
                            uploadStatus={uploadStatus}
                        />
                    )}

                    <div className="emb-field-row">
                        <label className="emb-field" style={{ flex: 1 }}>
                            <span>Colours to extract: <strong>{numColors}</strong></span>
                            <input className="emb-range" type="range" min="2" max="12" value={numColors} onChange={(e) => setNumColors(Number(e.target.value))} />
                        </label>
                        <button type="button" className="emb-btn is-primary" onClick={extractFromImage} disabled={!uploadReady || isExtracting}>
                            {isExtracting ? 'Extracting…' : 'Extract colours'}
                        </button>
                    </div>

                    <div className="emb-field">
                        <label htmlFor="emb-manual-hex">Add a colour</label>
                        <div className="emb-field-row">
                            <input className="emb-color-input" type="color" value={normalizeHex(manualHex) || '#000000'} onChange={(e) => setManualHex(e.target.value)} aria-label="Pick a colour" />
                            <input id="emb-manual-hex" className="emb-input is-mono" value={manualHex} onChange={(e) => setManualHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addManual(); }} style={{ width: 120 }} />
                            <button type="button" className="emb-btn" onClick={addManual}><I d={ICON_PLUS} s={14} /> Add</button>
                        </div>
                    </div>

                    <div className="emb-field">
                        <label htmlFor="emb-pantone">Cross-reference a Pantone TCX code</label>
                        <div className="emb-field-row">
                            <input id="emb-pantone" className="emb-input" placeholder="e.g. 19-4052 or Classic Blue" value={pantoneQuery} onChange={(e) => setPantoneQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addFromPantone(); }} style={{ flex: 1, minWidth: 160 }} />
                            <button type="button" className="emb-btn" onClick={addFromPantone} disabled={!pantoneQuery.trim()}>Add from Pantone</button>
                        </div>
                    </div>

                    {sources.length > 0 ? (
                        <ul className="emb-source-list" aria-label="Source colour list">
                            {sources.map((source) => (
                                <li key={source.hex} className="emb-source-item">
                                    <span className="emb-swatch" style={{ background: source.hex }} />
                                    <code>{source.hex}</code>
                                    {source.weight != null && <span className="emb-weight">{Math.round(source.weight * 100)}% of artwork</span>}
                                    {source.label && source.weight == null && <span className="emb-weight">{source.label}</span>}
                                    <button type="button" className="emb-icon-btn" onClick={() => removeSource(source.hex)} aria-label={`Remove ${source.hex}`}>
                                        <I d={ICON_TRASH} s={14} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="emb-empty">
                            <strong>No colours yet</strong>
                            Extract them from an artwork, add a hex value, or cross-reference a Pantone code.
                        </div>
                    )}
                </section>

                <section className="emb-panel" aria-label="Thread matches">
                    <h2 className="emb-panel-title">
                        <strong>Matches on {activeCard?.name || 'shade card'}</strong>
                        <span>{isMatching ? 'Matching…' : `${chosenEntries.length} shades`}</span>
                    </h2>

                    {sources.length === 0 ? (
                        <div className="emb-empty">
                            <strong>Matches appear here</strong>
                            Each source colour gets its nearest three shades with a Delta E distance. Under 2 is a visual match.
                        </div>
                    ) : (
                        <ul className="emb-match-list">
                            {sources.map((source) => {
                                const options = matches[source.hex] || [];
                                const pickIndex = chosen[source.hex] ?? 0;
                                const pick = options[pickIndex];
                                const quality = pick ? deltaEQuality(pick.deltaE) : null;
                                return (
                                    <li key={source.hex} className="emb-match-row">
                                        <span className="emb-match-pair">
                                            <span className="emb-swatch" style={{ background: source.hex }} title={`Source ${source.hex}`} />
                                        </span>
                                        <span className="emb-match-arrow"><I d={ICON_ARROW} s={16} /></span>
                                        <div className="emb-match-main">
                                            {pick ? (
                                                <>
                                                    <div className="emb-match-title">
                                                        <span className="emb-swatch is-small" style={{ background: pick.hex }} />
                                                        <strong>{pick.code}</strong>
                                                        {pick.name && <span>{pick.name}</span>}
                                                        <span className={`emb-quality is-${quality.tone}`}>{quality.label} · ΔE {pick.deltaE.toFixed(1)}</span>
                                                    </div>
                                                    <div className="emb-alternates" aria-label={`Alternatives for ${source.hex}`}>
                                                        {options.map((option, index) => (
                                                            <button
                                                                key={option.code}
                                                                type="button"
                                                                className={`emb-alt${index === pickIndex ? ' is-active' : ''}`}
                                                                onClick={() => setChosen((prev) => ({ ...prev, [source.hex]: index }))}
                                                                title={`${option.code} ${option.name || ''} (ΔE ${option.deltaE})`}
                                                            >
                                                                <span className="emb-swatch is-dot" style={{ background: option.hex }} />
                                                                {option.code}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </>
                                            ) : (
                                                <span className="emb-hint">{isMatching ? 'Matching…' : 'No match'}</span>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    <div className="emb-field-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                        <input
                            className="emb-input"
                            placeholder={`Palette name, e.g. ${activeProject?.name || 'Saree'} border`}
                            value={paletteName}
                            onChange={(e) => setPaletteName(e.target.value)}
                            aria-label="Palette name"
                            style={{ flex: 1, minWidth: 180 }}
                        />
                        <button type="button" className="emb-btn is-primary" onClick={savePalette} disabled={!chosenEntries.length || isSaving || !activeProject?.id}>
                            {isSaving ? 'Saving…' : 'Save to project'}
                        </button>
                        <button type="button" className="emb-btn" onClick={exportCsv} disabled={!chosenEntries.length} title="Download the thread list as CSV">
                            <I d={ICON_DOWNLOAD} s={14} /> CSV
                        </button>
                    </div>

                    {savedPalettes.length > 0 && (
                        <div className="emb-field">
                            <label>Saved thread palettes</label>
                            <ul className="emb-saved-list">
                                {savedPalettes.map((palette) => (
                                    <li key={palette.id} className="emb-saved-item">
                                        <div>
                                            <strong>{palette.name}</strong>
                                            <br />
                                            <small>{palette.entries.length} shades · {palette.entries.slice(0, 4).map((e) => e.code).join(', ')}{palette.entries.length > 4 ? '…' : ''}</small>
                                        </div>
                                        <div className="emb-saved-swatches" aria-hidden="true">
                                            {palette.entries.slice(0, 8).map((entry, index) => (
                                                <span key={`${entry.code}-${index}`} className="emb-swatch is-dot" style={{ background: entry.hex }} />
                                            ))}
                                        </div>
                                        <button type="button" className="emb-icon-btn" style={{ marginLeft: 0 }} onClick={() => downloadTextFile(`${palette.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.csv`, threadPaletteToCsv(palette.entries))} aria-label={`Download ${palette.name} as CSV`}>
                                            <I d={ICON_DOWNLOAD} s={14} />
                                        </button>
                                        <button type="button" className="emb-icon-btn" style={{ marginLeft: 0 }} onClick={() => deletePalette(palette.id)} aria-label={`Delete ${palette.name}`}>
                                            <I d={ICON_TRASH} s={14} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            </div>
            <input {...inputProps} />
        </div>
    );
}
