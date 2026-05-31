import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function VectorizeTool(props) {
    const {
        uploaded, preview, activeProject, user, controls, setError, addBgTask, updateCreditsFromResponse,
        setUploads, tool, currentToken, state
    } = props;

    const [isVec, setIsVec] = useState(false);
    const [vecIsolate, setVecIsolate] = useState(false);
    const [vecUrl, setVecUrl] = useState(null);
    const [isUpscaling, setIsUpscaling] = useState(false);
    const [upscaleFactor, setUpscaleFactor] = useState('x4');
    const [upscaleUrl, setUpscaleUrl] = useState(null);

    const vectorize = async () => {
        if (!uploaded || isVec) return;
        setIsVec(true);
        setVecUrl(null);
        try {
            const formData = new FormData();
            formData.append('image', uploaded);
            formData.append('isolate', vecIsolate);
            const res = await fetch(`${API}/api/vectorize`, {
                method: 'POST',
                headers: { ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}) },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Vectorization failed');
            updateCreditsFromResponse(data);
            setVecUrl(data.urls || data.url);
        } catch (err) {
            setError(err.message || 'Vectorization failed');
        } finally {
            setIsVec(false);
        }
    };

    const upscale = async () => {
        if (!uploaded || isUpscaling) return;
        setIsUpscaling(true);
        setUpscaleUrl(null);
        try {
            const formData = new FormData();
            formData.append('image', uploaded);
            formData.append('factor', upscaleFactor);
            const res = await fetch(`${API}/api/upscale`, {
                method: 'POST',
                headers: { ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}) },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upscale failed');
            updateCreditsFromResponse(data);
            setUpscaleUrl(data.urls || data.url);
        } catch (err) {
            setError(err.message || 'Upscale failed');
        } finally {
            setIsUpscaling(false);
        }
    };

    const resultUrl = tool === 'vectorize' ? vecUrl : upscaleUrl;
    const loading = tool === 'vectorize' ? isVec : isUpscaling;
    return (
        <>
{tool === 'vectorize' ? (
            <div className="st-ctrl">
                <label className="st-label" style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: '1rem', display: 'block' }}>
                    Using High-Fidelity Cloud Vectorization (API)
                </label>
                <div className="st-toggle-row"><span>Isolate Motif</span><label className="st-toggle"><input type="checkbox" checked={vecIsolate} onChange={(e) => setVecIsolate(e.target.checked)} /><span className="st-toggle-slider" /></label></div>
                <button className="st-export-btn" onClick={vectorize} disabled={isVec || !uploaded}>{isVec ? 'Vectorizing...' : 'Vectorize Image'}</button>
            </div>

) : (
            <div className="st-ctrl">
                <label className="st-label">Resolution Factor</label>
                <div className="st-btn-row">
                    <button className={`st-grid-btn ${upscaleFactor === 'x2' ? 'active' : ''}`} onClick={() => setUpscaleFactor('x2')}>2x</button>
                    <button className={`st-grid-btn ${upscaleFactor === 'x4' ? 'active' : ''}`} onClick={() => setUpscaleFactor('x4')}>4x</button>
                </div>
                <button className="st-export-btn" onClick={upscale} disabled={isUpscaling || !uploaded}>
                    {isUpscaling ? 'Upscaling...' : 'Enhance Resolution'}
                </button>
            </div>

)}
            <div className="st-compare">
                <div className="st-compare-panel"><div className="st-compare-label">ORIGINAL</div>{preview ? <img src={preview} alt="Original" /> : <span className="st-compare-empty">Upload an image</span>}</div>
                <div className="st-compare-divider">{loading ? <div className="st-spinner" /> : '->'}</div>
                <div className="st-compare-panel">
                    <div className="st-compare-label">RESULT</div>
                    {resultUrl ? (
                        Array.isArray(resultUrl) ? (
                            <div style={{ display: 'flex', gap: '10px', height: '100%', alignItems: 'center' }}>
                                {resultUrl.map((url, i) => (
                                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <img src={url} alt={`Result ${i + 1}`} style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />
                                        <a href={url} onClick={(e) => forceDownload(e, url)} className="st-dl-btn">Download</a>
                                    </div>
                                ))}
                            </div>
                        ) : <>
                            <img src={resultUrl} alt="Result" style={{ maxWidth: '100%', maxHeight: '320px', objectFit: 'contain' }} />
                            <a href={resultUrl} onClick={(e) => forceDownload(e, resultUrl)} className="st-dl-btn" style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem' }}>Download {tool === 'vectorize' ? 'SVG' : 'PNG'}</a>
                        </>
                    ) : loading ? <span className="st-processing">Processing...</span> : <span className="st-compare-empty">Result appears here</span>}
                </div>
            </div>

        </>
    );
}
