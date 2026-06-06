import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function InspireTool({ uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse }) {
    const [prompt, setPrompt] = useState('');
    const [creativity, setCreativity] = useState(3);
    const [variants, setVariants] = useState(3);
    const [inspireColors, setInspireColors] = useState(['#94b09e', '#e7dec2', '#dca5a2']);
    const [inspireStyle, setInspireStyle] = useState('All Styles');
    const [generatedVariations, setGeneratedVariations] = useState([]);
    const [isDesc, setIsDesc] = useState(false);
    const [isGen, setIsGen] = useState(false);
    const [creditPricing] = useState({ inspire: 50 });

    const fileRef = React.useRef(null);

    const descImg = async () => {
        if (!uploaded) return;
        setIsDesc(true);
        try {
            const res = await fetch(`${API}/api/describe-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: uploaded.filename }),
            });
            const d = await res.json();
            if (d.success) setPrompt(d.description || '');
        } catch (e) { setError(e.message); }
        finally { setIsDesc(false); }
    };

    const generate = async () => {
        if (!prompt.trim() && !uploaded) return;
        setIsGen(true);
        setError('');
        try {
            const res = await fetch(`${API}/api/generate-inspiration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    filename: uploaded?.filename,
                    creativity,
                    variants,
                    colors: inspireColors,
                    style: inspireStyle,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                setGeneratedVariations(d.urls || []);
                updateCreditsFromResponse(d);
            } else {
                throw new Error(d.error || 'Generation failed');
            }
        } catch (e) { setError(e.message); }
        finally { setIsGen(false); }
    };

    const handleUpload = (file) => {
        // Placeholder — parent should handle upload
    };

    return (
        <div className="st-inspire-main">
            {/* Upload Box */}
            <div
                className={`st-inspire-upload-box ${preview ? 'has-image' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}
                onDragOver={(e) => e.preventDefault()}
            >
                {preview ? (
                    <div className="st-upload-preview" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <img src={preview} alt="Uploaded reference" style={{ maxHeight: '160px', borderRadius: '8px', objectFit: 'contain' }} />
                        <div><span className="st-upload-name">{uploaded?.originalName || 'Image Uploaded'}</span><span className="st-upload-hint">Click to replace</span></div>
                    </div>
                ) : (
                    <>
                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={24} />
                        <h3>Upload reference image (optional)</h3>
                        <p>PNG, JPG up to 10MB</p>
                    </>
                )}
            </div>

            {/* Prompt Box */}
            <div className="st-inspire-prompt-container">
                <div className="st-inspire-prompt-top">
                    <div className="st-inspire-prompt-icon">
                        <I d="M5 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM16 12l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM14 2l1.5 4.5L20 8l-4.5 1.5L14 14l-1.5-4.5L8 8l4.5-1.5L14 2z" s={20} />
                    </div>
                    <input
                        className="st-inspire-prompt-input"
                        placeholder="Describe the pattern inspiration you want to create..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && generate()}
                    />
                </div>
                <div className="st-inspire-prompt-bottom">
                    <div className="st-inspire-tags">
                        {['Floral', 'Geometric', 'Minimal', 'Vintage', 'Watercolor', 'Tropical'].map(t => (
                            <button key={t} className="st-inspire-tag" onClick={() => setPrompt(prev => prev ? `${prev}, ${t}` : t)}>
                                <I d="M7 21l7-14M3 11h18M3 17h18" s={12} /> {t}
                            </button>
                        ))}
                    </div>
                    <div className="st-inspire-prompt-actions">
                        {uploaded && (
                            <button
                                className="st-btn"
                                onClick={descImg}
                                disabled={isDesc}
                                style={{ background: '#f5f3ff', color: 'var(--primary)', border: 'none', marginRight: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}
                                title="Auto-describe uploaded image"
                            >
                                <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={14} />
                                {isDesc ? 'Analyzing...' : 'Auto-Describe'}
                            </button>
                        )}
                        <button className="st-inspire-send-btn" onClick={generate} disabled={isGen}>
                            <I d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" s={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Generated Variations */}
            <div className="st-inspire-section">
                <div className="st-inspire-section-header">
                    <div className="st-inspire-section-title">
                        <h2>Generated Variations</h2>
                        <p>Generated from your prompt</p>
                    </div>
                    <a href="#" className="st-inspire-section-link"><I d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" s={14} /> View history</a>
                </div>
                {isGen ? (
                    <div className="st-loading" style={{ height: '200px' }}><div className="st-spinner" /><span>Generating variations...</span></div>
                ) : generatedVariations.length > 0 ? (
                    <div className="st-inspire-var-grid">
                        {generatedVariations.map((u, i) => (
                            <div key={u} className={`st-inspire-var-item ${i === 0 ? 'active' : ''}`}>
                                <img src={u} alt={`Variation ${i + 1}`} />
                                <div className="st-inspire-var-actions">
                                    <button className="st-inspire-var-btn"><I d="M20.8 4.6a5.5 5.5 0 0 0-7.7 0l-1.1 1-1.1-1a5.5 5.5 0 0 0-7.8 7.8l1 1 7.9 7.9 7.9-7.9 1-1a5.5 5.5 0 0 0 0-7.8z" s={14} /></button>
                                    <button className="st-inspire-var-btn" onClick={(e) => forceDownload(e, u)}><I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /></button>
                                    <button className="st-inspire-var-btn"><I d="M5 12h.01M12 12h.01M19 12h.01" s={14} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="st-empty-canvas" style={{ minHeight: '160px', background: 'transparent' }}>
                        <p>Enter a prompt above to generate beautiful variations.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
