import React, { useState, useRef } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function PatternTool(props) {
    const {
        uploaded, preview, activeProject, user, controls, setError, addBgTask, updateCreditsFromResponse,
        setUploads, tool, currentToken, state
    } = props;

    const [isEnh, setIsEnh] = useState(false);
    const [enhUrl, setEnhUrl] = useState(null);
    const [isDrag, setIsDrag] = useState(false);
    const fileRef = useRef(null);

    const handleUpload = (file) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        setUploads(prev => ({ ...prev, [tool]: { file, url } }));
    };

    const extractDesign = async () => {
        if (!uploaded && !preview && !activeProject?.heroImageUrl) return;
        setIsEnh(true);
        setEnhUrl(null);
        try {
            const formData = new FormData();
            if (uploaded) {
                formData.append('image', uploaded);
            } else {
                formData.append('imageUrl', preview || activeProject?.heroImageUrl);
            }
            const res = await fetch(`${API}/api/extract-design`, {
                method: 'POST',
                headers: { ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}) },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Extraction failed');
            updateCreditsFromResponse(data);
            setEnhUrl(data.urls || data.url);
        } catch (err) {
            setError(err.message || 'Design extraction failed');
        } finally {
            setIsEnh(false);
        }
    };

    const loading = isEnh;
    return (
        <>

            <div className="st-pattern-right">
                <div className="st-pattern-right-title">
                    <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={20} />
                    Design Extraction
                </div>
                <p className="st-pattern-right-desc">
                    AI analyzes your outfit or fabric image and extracts a clean, seamless, print-ready repeating pattern.
                </p>
                <button className="st-pattern-right-btn" onClick={extractDesign} disabled={isEnh || (!uploaded && !preview && !activeProject?.heroImageUrl)}>
                    <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={16} />
                    {isEnh ? 'Extracting...' : 'Extract Design'}
                </button>
                <div className="st-pattern-features-title">What you get</div>
                <div className="st-pattern-feature">
                    <div className="st-pattern-feature-icon"><I d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z" s={18} /></div>
                    <div className="st-pattern-feature-text">
                        <h4>Seamless output</h4>
                        <p>Perfectly tileable patterns with no visible seams.</p>
                    </div>
                </div>
                <div className="st-pattern-feature">
                    <div className="st-pattern-feature-icon"><I d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8z" s={18} /></div>
                    <div className="st-pattern-feature-text">
                        <h4>Print-ready</h4>
                        <p>High-quality files optimized for digital and physical printing.</p>
                    </div>
                </div>
                <div className="st-pattern-feature">
                    <div className="st-pattern-feature-icon"><I d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M8 10v4 M12 10v4 M16 10v4" s={18} /></div>
                    <div className="st-pattern-feature-text">
                        <h4>High-resolution</h4>
                        <p>Crisp, high-resolution results suitable for any scale.</p>
                    </div>
                </div>
                <div className="st-pattern-security">
                    <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" s={16} />
                    <p>Your designs are private and secure. Only you can access your projects.</p>
                </div>
            </div>
        

                <div className="st-pattern-layout">
                    <div
                        className={`st-pattern-upload ${isDrag ? 'dragging' : ''}`}
                        onClick={() => fileRef.current?.click()}
                        onDrop={(e) => { e.preventDefault(); setIsDrag(false); handleUpload(e.dataTransfer.files[0]); }}
                        onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                        onDragLeave={() => setIsDrag(false)}
                    >
                        <div className="st-pattern-upload-icon">
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={20} />
                        </div>
                        <strong>Upload an image or drag &amp; drop</strong>
                        <p>JPG, PNG &bull; Up to 50MB &bull; Recommended: 3000px or higher</p>
                    </div>

                    <div className="st-pattern-panels">
                        <div className="st-pattern-panel">
                            <div className="st-pattern-panel-label">Original</div>
                            {preview ? (
                                <img src={preview} alt="Original" className="st-pattern-image" />
                            ) : (
                                <>
                                    <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="25" y="30" width="60" height="65" rx="8" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="2" transform="rotate(-10 25 30)" />
                                        <rect x="40" y="25" width="60" height="65" rx="8" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                                        <circle cx="55" cy="45" r="6" fill="#E5E7EB" />
                                        <path d="M40 70L55 55L75 75L85 65L100 80" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <div className="st-pattern-empty-title">No image uploaded</div>
                                    <div className="st-pattern-empty-desc">Upload an outfit or fabric image to get started.</div>
                                    <button className="st-pattern-btn-outline" onClick={() => fileRef.current?.click()}>
                                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={16} />
                                        Upload Image
                                    </button>
                                </>
                            )}
                        </div>

                        <div className="st-pattern-arrow">
                            <I d="M5 12h14M12 5l7 7-7 7" s={18} />
                        </div>

                        <div className="st-pattern-panel">
                            <div className="st-pattern-panel-label">Extracted Pattern</div>
                            {enhUrl ? (
                                Array.isArray(enhUrl) ? (
                                    <div style={{ position: 'absolute', inset: '0', padding: '3.5rem 1rem 1rem', display: 'flex', gap: '10px' }}>
                                        {enhUrl.map((url, i) => (
                                            <div key={i} style={{ flex: 1, position: 'relative' }}>
                                                <img src={url} alt={`Result ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '8px' }} />
                                                <a href={url} onClick={(e) => forceDownload(e, url)} className="st-dl-btn" style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem' }}>Download</a>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <>
                                        <img src={enhUrl} alt="Result" className="st-pattern-image" />
                                        <a href={enhUrl} onClick={(e) => forceDownload(e, enhUrl)} className="st-dl-btn" style={{ position: 'absolute', bottom: '1rem', right: '1rem' }}>Download</a>
                                    </>
                                )
                            ) : loading ? (
                                <div className="st-loading"><div className="st-spinner" /><span>Extracting Pattern...</span></div>
                            ) : (
                                <>
                                    <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="35" y="30" width="60" height="60" rx="8" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="2" strokeDasharray="4 4" />
                                        <path d="M50 45C50 45 55 50 60 45C65 40 70 45 70 45" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M45 60C45 60 50 55 55 60C60 65 65 60 65 60" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M55 75C55 75 60 70 65 75C70 80 75 75 75 75" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M75 55L75 60M85 30L90 35M30 75L25 70" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round" />
                                        <path d="M92 40L95 48L103 51L95 54L92 62L89 54L81 51L89 48Z" fill="#C7D2FE" />
                                        <path d="M40 20L42 25L47 27L42 29L40 34L38 29L33 27L38 25Z" fill="#E0E7FF" />
                                    </svg>
                                    <div className="st-pattern-empty-title">Extracted pattern will appear here</div>
                                    <div className="st-pattern-empty-desc">Our AI will analyze your image and generate a clean, seamless repeating design.</div>
                                    <button className="st-pattern-btn-outline" disabled={true}>
                                        <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={16} />
                                        Extract Design
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            
        </>
    );
}
