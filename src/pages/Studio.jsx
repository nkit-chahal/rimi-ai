import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

const API = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

const forceDownload = async (e, url) => {
  e.preventDefault();
  if (!url) return;
  
  try {
    // Determine the proxy URL
    let downloadUrl = url;
    if (!(url.startsWith('/') && !url.startsWith('/results/') && !url.startsWith('/uploads/'))) {
      downloadUrl = `${API}/api/download?url=${encodeURIComponent(url)}`;
    }

    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error('Download failed');
    
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = blobUrl;
    
    // Attempt to get filename from headers
    const disposition = res.headers.get('content-disposition');
    let filename = 'rim_ai_export.png';
    if (disposition && disposition.includes('filename=')) {
      filename = disposition.split('filename=')[1].replace(/"/g, '');
    } else {
      const parts = url.split('/');
      const last = parts[parts.length - 1];
      if (last && !last.includes('?')) filename = last;
    }
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Forced download failed, falling back:', err);
    // Fallback: open in new tab
    window.open(url, '_blank');
  }
};

const I = ({ d, s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const NAV = [
  { section: '', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }] },
  {
    section: 'AI DESIGN TOOLS',
    items: [
      { id: 'pattern', label: 'Pattern Extraction', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z' },
      { id: 'repeat', label: 'Repeat Set', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
      { id: 'inspire', label: 'Inspirations', icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2c3.1 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z' },
      { id: 'vectorize', label: 'Vectorize', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z' },
      { id: 'upscale', label: 'Super Resolution', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
    ],
  },
  {
    section: 'ASSETS & LIBRARY',
    items: [
      { id: 'library', label: 'Brand Library', icon: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z' },
      { id: 'exports', label: 'Exports', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3' },
    ],
  },
];

const emptyState = {
  user: { name: '', initials: '', plan: '', creditsUsed: 0, creditsLimit: 1, resetDays: 0 },
  activeProject: { id: 1, name: 'Loading...', heroImageUrl: '/demo_floral.png' },
  projects: [],
  variations: [],
  metrics: { versions: 0, versionsDelta: 0, exports: 0, exportsDelta: 0, aiGenerations: 0, aiGenerationsDelta: 0, creditsUsed: 0, creditsDelta: 0 },
  health: { score: 0, label: '', tileSeamless: false, colorBalance: false, printReadiness: false, resolution: false, note: '' },
  controls: { gridSize: 2, scale: 100, rotation: 0, repeatType: 'block', colorCleanup: true, edgeMatch: true, backgroundClean: false, exportFormat: 'PNG', exportDpi: 300, hBrush: 8, vBrush: 8, printWidth: 12 },
  suggestion: '',
};

export default function Studio({ onBack }) {
  const [tool, setTool] = useState('pattern');
  const [state, setState] = useState(emptyState);
  const [activeProjectId, setActiveProjectId] = useState(1);
  const [controlTab, setControlTab] = useState('controls');
  const [uploads, setUploads] = useState({});
  const [isDrag, setIsDrag] = useState(false);
  const [error, setError] = useState('');
  const [isLoadingState, setIsLoadingState] = useState(true);

  const fileRef = useRef(null);
  const canvasRef = useRef(null);
  const hasLoadedControls = useRef(false);

  const uploaded = useMemo(() => uploads[tool]?.file || null, [uploads, tool]);
  const preview = useMemo(() => uploads[tool]?.url || null, [uploads, tool]);
  const controls = state.controls;
  const activeProject = state.activeProject;

  const [prompt, setPrompt] = useState('');
  const [creativity, setCreativity] = useState(3);
  const [variants, setVariants] = useState(3);
  const [generatedVariations, setGeneratedVariations] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [isDesc, setIsDesc] = useState(false);
  const [isGen, setIsGen] = useState(false);

  const [enhScale, setEnhScale] = useState(4);
  const [isEnh, setIsEnh] = useState(false);
  const [enhUrl, setEnhUrl] = useState(null);

  const [vecEngine, setVecEngine] = useState('local');
  const [vecColors, setVecColors] = useState(32);
  const [vecIsolate, setVecIsolate] = useState(false);
  const [isVec, setIsVec] = useState(false);
  const [vecUrl, setVecUrl] = useState(null);

  const [repeatUrl, setRepeatUrl] = useState(null);
  const [repeatMaskUrl, setRepeatMaskUrl] = useState(null);
  const [isRepeat, setIsRepeat] = useState(false);

  const [upscaleFactor, setUpscaleFactor] = useState('x4');
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaleUrl, setUpscaleUrl] = useState(null);

  const loadStudioState = useCallback(async (projectId = activeProjectId) => {
    setError('');
    try {
      const r = await fetch(`${API}/api/studio-state?projectId=${projectId}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Failed to load studio state');
      hasLoadedControls.current = false;
      setState(d.state);
      setActiveProjectId(d.state.activeProject.id);
      window.setTimeout(() => { hasLoadedControls.current = true; }, 0);
    } catch {
      setError('Backend is not connected. Start Flask on port 3001 so dashboard data can sync from SQLite.');
    } finally {
      setIsLoadingState(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    loadStudioState(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateControls = useCallback((patch) => {
    setState((current) => ({ ...current, controls: { ...current.controls, ...patch } }));
  }, []);

  useEffect(() => {
    if (!hasLoadedControls.current) return;
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/projects/${activeProject.id}/controls`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(controls),
        });
        const d = await r.json();
        if (d.success) setState(d.state);
      } catch {
        setError('Control changes are local only because the SQLite API is offline.');
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [controls, activeProject.id]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const baseW = 980;
      const tw = Math.floor(baseW / controls.gridSize);
      const th = Math.floor((tw / img.width) * img.height);
      c.width = tw * controls.gridSize;
      c.height = th * controls.gridSize;
      ctx.fillStyle = '#fbfaf7';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((controls.rotation * Math.PI) / 180);
      ctx.translate(-c.width / 2, -c.height / 2);
      const drawW = tw * (controls.scale / 100);
      const drawH = th * (controls.scale / 100);

      const expand = 2;
      if (controls.repeatType === 'half_brick') {
        for (let r = -expand; r < controls.gridSize + expand; r += 1) {
          const offset = Math.abs(r) % 2 ? Math.floor(tw / 2) : 0;
          for (let col = -expand; col <= controls.gridSize + expand; col += 1) ctx.drawImage(img, col * tw + offset, r * th, drawW, drawH);
        }
      } else if (controls.repeatType === 'half_drop') {
        for (let col = -expand; col < controls.gridSize + expand; col += 1) {
          const offset = Math.abs(col) % 2 ? Math.floor(th / 2) : 0;
          for (let r = -expand; r <= controls.gridSize + expand; r += 1) ctx.drawImage(img, col * tw, r * th + offset, drawW, drawH);
        }
      } else if (controls.repeatType === 'mirror') {
        for (let r = -expand; r < controls.gridSize + expand; r += 1) {
          for (let col = -expand; col < controls.gridSize + expand; col += 1) {
            ctx.save();
            ctx.translate(col * tw + (Math.abs(col) % 2 ? tw : 0), r * th);
            ctx.scale(Math.abs(col) % 2 ? -1 : 1, 1);
            ctx.drawImage(img, 0, 0, drawW, drawH);
            ctx.restore();
          }
        }
      } else {
        for (let r = -expand; r < controls.gridSize + expand; r += 1) {
          for (let col = -expand; col < controls.gridSize + expand; col += 1) {
            ctx.drawImage(img, col * tw, r * th, drawW, drawH);
          }
        }
      }
      
      // Draw visual mask for seam brushes to give user feedback
      if (controlTab === 'advanced' && controls.edgeMatch && (controls.hBrush > 0 || controls.vBrush > 0)) {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.35)'; // Purple/Indigo overlay
        
        // Ensure we draw the grid seams over the entire expanded area
        for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
          if (controls.hBrush > 0) {
            // Horizontal seams (between rows)
            // Adjust for staggered layouts
            if (controls.repeatType === 'half_drop') {
              for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
                const offset = Math.abs(col) % 2 ? Math.floor(th / 2) : 0;
                ctx.fillRect(col * tw, r * th + offset - controls.hBrush / 2, tw, controls.hBrush);
              }
            } else {
              ctx.fillRect(-expand * tw, r * th - controls.hBrush / 2, (controls.gridSize + expand * 2) * tw, controls.hBrush);
            }
          }
        }
        for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
          if (controls.vBrush > 0) {
            // Vertical seams (between cols)
            if (controls.repeatType === 'half_brick') {
              for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
                const offset = Math.abs(r) % 2 ? Math.floor(tw / 2) : 0;
                ctx.fillRect(col * tw + offset - controls.vBrush / 2, r * th, controls.vBrush, th);
              }
            } else {
              ctx.fillRect(col * tw - controls.vBrush / 2, -expand * th, controls.vBrush, (controls.gridSize + expand * 2) * th);
            }
          }
        }
      }

      ctx.restore();
    };
    img.src = preview || activeProject.heroImageUrl || '/demo_floral.png';
  }, [controls, preview, activeProject.heroImageUrl, controlTab]);

  const handleUpload = useCallback(async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setUploads((p) => ({ ...p, [tool]: { ...p[tool], url: e.target.result } }));
    reader.readAsDataURL(file);
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await fetch(`${API}/api/upload`, { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) setUploads((p) => ({ ...p, [tool]: { file: d, url: p[tool]?.url || null } }));
      else setError(d.error || 'Upload failed');
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    }
  }, [tool]);

  const descImg = async () => {
    if (!uploaded?.filename) return;
    setIsDesc(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/describe-image`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          filename: uploaded.filename, 
          projectId: activeProject.id,
          creativity 
        }) 
      });
      const d = await r.json();
      if (d.success) {
        setAnalysis(d.analysis);
        setPrompt(d.description);
      } else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsDesc(false);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) {
      setError('Enter a prompt');
      return;
    }
    setIsGen(true);
    setError('');
    setGeneratedVariations([]);
    
    const activeUrl = preview || activeProject.heroImageUrl;
    let safeFilename = uploaded?.filename;
    let safeUrl = !uploaded ? activeUrl : null;
    
    if (!safeFilename && safeUrl && safeUrl.includes('/uploads/')) {
        safeFilename = safeUrl.split('/').pop();
        safeUrl = null;
    }

    try {
      const r = await fetch(`${API}/api/generate-inspirations`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          prompt, 
          creativity, 
          count: variants, 
          projectId: activeProject.id,
          filename: safeFilename,
          imageUrl: safeUrl
        }) 
      });
      const d = await r.json();
      if (d.success) setGeneratedVariations(d.variations);
      else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsGen(false);
    }
  };

  const createRepeat = async (inpaint = true) => {
    const activeUrl = preview || activeProject.heroImageUrl;
    if (!uploaded && !activeUrl) {
      setError('Select a pattern variation first to export a repeat set.');
      return;
    }

    let safeFilename = uploaded?.filename;
    let safeUrl = !uploaded ? activeUrl : null;
    
    // If we have a local URL instead of an upload object, extract the filename
    if (!safeFilename && safeUrl && safeUrl.includes('/uploads/')) {
        safeFilename = safeUrl.split('/').pop();
        safeUrl = null;
    }

    setIsRepeat(true);
    setError('');
    setRepeatUrl(null);
    try {
      const r = await fetch(`${API}/api/create-repeat-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          filename: safeFilename,
          imageUrl: safeUrl,
          gridSize: controls.gridSize,
          repeatType: controls.repeatType,
          hBrush: controls.edgeMatch ? controls.hBrush : 0,
          vBrush: controls.edgeMatch ? controls.vBrush : 0,
          hOffset: 1,
          vOffset: 1,
          creativity: controls.colorCleanup ? 75 : 25,
          dpi: controls.exportDpi,
          printWidth: controls.printWidth,
          inpaint: inpaint && controls.edgeMatch,
          backgroundClean: controls.backgroundClean,
          format: controls.exportFormat,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setRepeatUrl(`${API}${d.resultUrl}`);
        if (d.maskUrl) setRepeatMaskUrl(`${API}${d.maskUrl}`);
        loadStudioState(activeProject.id);
      } else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsRepeat(false);
    }
  };

  const extractDesign = async () => {
    if (!uploaded) {
      setError('Upload first');
      return;
    }
    setIsEnh(true);
    setError('');
    setEnhUrl(null);
    try {
      const r = await fetch(`${API}/api/extract-design`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ filename: uploaded.filename, projectId: activeProject.id }) 
      });
      const d = await r.json();
      if (d.success) setEnhUrl(d.resultUrls); // Now an array of URLs from SDXL
      else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsEnh(false);
    }
  };

  const vectorize = async () => {
    const activeUrl = preview || activeProject.heroImageUrl;
    if (!uploaded && !activeUrl) {
      setError('Upload an image first');
      return;
    }

    let safeFilename = uploaded?.filename;
    let safeUrl = !uploaded ? activeUrl : null;

    // Extract filename from local URLs (/uploads/xxx.png or /demo_floral.png)
    if (!safeFilename && safeUrl && !safeUrl.startsWith('http')) {
      safeFilename = safeUrl.split('/').pop();
      safeUrl = null;
    }

    setIsVec(true);
    setError('');
    setVecUrl(null);
    try {
      const r = await fetch(`${API}/api/vectorize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: safeFilename, imageUrl: safeUrl, engine: vecEngine, numColors: vecColors, removeBg: vecIsolate, projectId: activeProject.id }) });
      const d = await r.json();
      if (d.success) setVecUrl(`${API}${d.resultUrl}`);
      else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsVec(false);
    }
  };

  const upscale = async () => {
    if (!uploaded) {
      setError('Upload first');
      return;
    }
    setIsUpscaling(true);
    setError('');
    setUpscaleUrl(null);
    try {
      const r = await fetch(`${API}/api/upscale`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ filename: uploaded.filename, upscaleFactor, projectId: activeProject.id }) 
      });
      const d = await r.json();
      if (d.success) setUpscaleUrl(`${API}${d.resultUrl}`);
      else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsUpscaling(false);
    }
  };

  const toolLabel = {
    dashboard: 'Dashboard',
    pattern: 'Pattern Extraction',
    repeat: 'Repeat Set',
    inspire: 'Inspirations',
    vectorize: 'Vectorize',
    upscale: 'Super Resolution',
    library: 'Brand Library',
    exports: 'Exports',
  }[tool] || tool;

  const metrics = [
    ['Versions', state.metrics.versions, state.metrics.versionsDelta],
    ['Exports', state.metrics.exports, state.metrics.exportsDelta],
    ['AI Generations', state.metrics.aiGenerations, state.metrics.aiGenerationsDelta],
    ['Credits Used', state.metrics.creditsUsed, state.metrics.creditsDelta],
  ];

  const renderControls = () => {
    if (tool === 'repeat') {
      return (
        <div className="st-ctrl">
          <div className="st-ctrl-tabs">
            <button className={controlTab === 'controls' ? 'active' : ''} onClick={() => setControlTab('controls')}>Controls</button>
            <button className={controlTab === 'advanced' ? 'active' : ''} onClick={() => setControlTab('advanced')}>Advanced</button>
          </div>
          {controlTab === 'controls' ? (
            <>
              <label className="st-label">Grid Size</label>
              <div className="st-btn-row">{[2, 3, 4, 5, 6].map((n) => <button key={n} className={`st-grid-btn ${controls.gridSize === n ? 'active' : ''}`} onClick={() => updateControls({ gridSize: n })}>{n}x{n}</button>)}</div>
              <label className="st-label">Scale</label>
              <div className="st-scale-row"><button onClick={() => updateControls({ scale: Math.max(50, controls.scale - 10) })}>-</button><span>{controls.scale}%</span><button onClick={() => updateControls({ scale: Math.min(200, controls.scale + 10) })}>+</button></div>
              <input type="range" min="50" max="200" value={controls.scale} onChange={(e) => updateControls({ scale: +e.target.value })} className="st-range" />
              <div className="st-range-labels"><span>50%</span><span>200%</span></div>
              <label className="st-label">Rotation</label>
              <div className="st-scale-row"><button onClick={() => updateControls({ rotation: (controls.rotation - 15 + 360) % 360 })}>R-</button><span>{controls.rotation}deg</span><button onClick={() => updateControls({ rotation: (controls.rotation + 15) % 360 })}>R+</button></div>
              <label className="st-label">Symmetry</label>
              <div className="st-btn-row st-sym-row">
                {[{ v: 'block', l: 'Grid' }, { v: 'half_brick', l: 'Brick' }, { v: 'half_drop', l: 'Drop' }, { v: 'mirror', l: 'Mirror' }].map((r) => (
                  <button key={r.v} className={`st-sym-btn ${controls.repeatType === r.v ? 'active' : ''}`} onClick={() => updateControls({ repeatType: r.v })} title={r.l}>{r.l[0]}</button>
                ))}
              </div>
              <div className="st-toggle-row"><span>AI Color Cleanup</span><label className="st-toggle"><input type="checkbox" checked={controls.colorCleanup} onChange={(e) => updateControls({ colorCleanup: e.target.checked })} /><span className="st-toggle-slider" /></label></div>
              <div className="st-toggle-row"><span>Edge Matching</span><label className="st-toggle"><input type="checkbox" checked={controls.edgeMatch} onChange={(e) => updateControls({ edgeMatch: e.target.checked })} /><span className="st-toggle-slider" /></label></div>
              <div className="st-toggle-row"><span>Background Clean</span><label className="st-toggle"><input type="checkbox" checked={controls.backgroundClean} onChange={(e) => updateControls({ backgroundClean: e.target.checked })} /><span className="st-toggle-slider" /></label></div>
            </>
          ) : (
            <>
              <label className="st-label">Horizontal Seam Brush</label>
              <input type="range" min="0" max="64" value={controls.hBrush} onChange={(e) => updateControls({ hBrush: +e.target.value })} className="st-range" />
              <div className="st-range-labels"><span>0 px</span><span>{controls.hBrush} px</span></div>
              <label className="st-label">Vertical Seam Brush</label>
              <input type="range" min="0" max="64" value={controls.vBrush} onChange={(e) => updateControls({ vBrush: +e.target.value })} className="st-range" />
              <div className="st-range-labels"><span>0 px</span><span>{controls.vBrush} px</span></div>
              <label className="st-label">Print Width</label>
              <div className="st-scale-row"><button onClick={() => updateControls({ printWidth: Math.max(4, controls.printWidth - 1) })}>-</button><span>{controls.printWidth} in</span><button onClick={() => updateControls({ printWidth: Math.min(60, controls.printWidth + 1) })}>+</button></div>
              <div className="st-analysis-pill">Saved to SQLite for project #{activeProject.id}</div>
            </>
          )}
          <details className="st-export-opts" open>
            <summary>Export Options</summary>
            <div className="st-export-grid">
              <div><label className="st-label-sm">Format</label><select value={controls.exportFormat} onChange={(e) => updateControls({ exportFormat: e.target.value })} className="st-select"><option>PNG</option><option>JPG</option><option>TIFF</option></select></div>
              <div><label className="st-label-sm">Resolution</label><select value={controls.exportDpi} onChange={(e) => updateControls({ exportDpi: +e.target.value })} className="st-select"><option value={150}>150 DPI</option><option value={300}>300 DPI</option><option value={600}>600 DPI</option></select></div>
            </div>
          </details>
          <button className="st-export-btn" onClick={() => createRepeat(true)} disabled={isRepeat || (!uploaded && !preview && !activeProject?.heroImageUrl)}>{isRepeat ? 'Processing...' : 'Export Repeat Set'}</button>
        </div>
      );
    }
    if (tool === 'inspire') return (
      <div className="st-ctrl">
        <label className="st-label">Describe your pattern</label>
        <textarea className="st-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Watercolor floral with soft leaves..." rows={3} />
        {uploaded && <button className="st-sm-btn" onClick={descImg} disabled={isDesc}>{isDesc ? 'Analyzing...' : 'Auto-Describe'}</button>}
        {analysis?.difficulty && <div className="st-analysis-pill">{analysis.imageType} / {analysis.difficulty}</div>}
        <label className="st-label">Creativity</label>
        <input type="range" min="1" max="5" value={creativity} onChange={(e) => setCreativity(+e.target.value)} className="st-range" />
        <div className="st-range-labels"><span>Safe</span><span>Wild</span></div>
        <label className="st-label">Variants</label>
        <div className="st-btn-row">{[1, 3, 5, 7].map((n) => <button key={n} className={`st-grid-btn ${variants === n ? 'active' : ''}`} onClick={() => setVariants(n)}>{n}</button>)}</div>
        <button className="st-export-btn" onClick={generate} disabled={isGen}>{isGen ? 'Generating...' : 'Generate Variations'}</button>
      </div>
    );
    if (tool === 'vectorize') return (
      <div className="st-ctrl">
        <label className="st-label">Engine</label>
        <div className="st-btn-row"><button className={`st-grid-btn ${vecEngine === 'local' ? 'active' : ''}`} onClick={() => setVecEngine('local')}>Local</button><button className={`st-grid-btn ${vecEngine === 'api' ? 'active' : ''}`} onClick={() => setVecEngine('api')}>API</button></div>
        {vecEngine === 'local' && <><label className="st-label">Colors: {vecColors}</label><input type="range" min="2" max="256" value={vecColors} onChange={(e) => setVecColors(+e.target.value)} className="st-range" /></>}
        <div className="st-toggle-row"><span>Isolate Motif</span><label className="st-toggle"><input type="checkbox" checked={vecIsolate} onChange={(e) => setVecIsolate(e.target.checked)} /><span className="st-toggle-slider" /></label></div>
        <button className="st-export-btn" onClick={vectorize} disabled={isVec || !uploaded}>{isVec ? 'Vectorizing...' : 'Vectorize Image'}</button>
      </div>
    );
    if (tool === 'upscale') return (
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
    );
    return (
      <div className="st-ctrl">
        <label className="st-label">Design Extraction</label>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '16px', lineHeight: '1.4' }}>
          Uses <strong>openai/gpt-image-2</strong> to analyze your outfit photo and extract the fabric design into perfectly flat, seamless repeating tiles.
        </p>
        <button className="st-export-btn" onClick={extractDesign} disabled={isEnh || !uploaded}>{isEnh ? 'Extracting...' : 'Extract Design'}</button>
      </div>
    );
  };

  const renderCanvas = () => {
    if (tool === 'repeat') {
      return (
        <div className="st-canvas-wrap">
          <canvas ref={canvasRef} className="st-canvas" />
          <button className="st-canvas-badge"><I d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 9a3 3 0 100 6 3 3 0 000-6z" s={14} />Tile Preview</button>
        </div>
      );
    }
    if (tool === 'exports') {
      return (
        <div className="st-inspire-canvas">
          {state.variations.length > 0 ? (
            <div className="st-var-grid">
              {state.variations.map((v, i) => (
                <div key={v.id} className="st-var-item">
                  <img src={v.imageUrl} alt={`Export ${i + 1}`} />
                  <a href={v.imageUrl} onClick={(e) => forceDownload(e, v.imageUrl)} className="st-dl-btn">Download</a>
                </div>
              ))}
            </div>
          ) : (
            <div className="st-empty-canvas"><span className="st-empty-icon">📁</span><p>No exports generated yet for this project.</p></div>
          )}
        </div>
      );
    }
    if (tool === 'vectorize' || tool === 'library' || tool === 'pattern' || tool === 'upscale') {
      const resultUrl = tool === 'vectorize' ? vecUrl : tool === 'upscale' ? upscaleUrl : enhUrl;
      const loading = tool === 'vectorize' ? isVec : tool === 'upscale' ? isUpscaling : isEnh;
      return (
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
                      <img src={url} alt={`Result ${i+1}`} style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />
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
      );
    }
    return (
      <div className="st-inspire-canvas">
        {isGen ? <div className="st-loading"><div className="st-spinner" /><span>Generating variations...</span></div>
          : generatedVariations.length > 0 ? <div className="st-var-grid">{generatedVariations.map((u, i) => <div key={u} className="st-var-item"><img src={u} alt={`Variation ${i + 1}`} /><a href={u} onClick={(e) => forceDownload(e, u)} className="st-dl-btn">Save</a></div>)}</div>
            : <div className="st-empty-canvas"><span className="st-empty-icon">AI</span><p>Enter a prompt and generate design variations</p></div>}
      </div>
    );
  };

  const creditPercent = Math.min(100, Math.round((state.user.creditsUsed / state.user.creditsLimit) * 100));

  const healthItems = [
    ['Tile Seamless', state.health.tileSeamless],
    ['Color Balance', state.health.colorBalance],
    ['Print Readiness', state.health.printReadiness],
    ['Resolution', state.health.resolution],
  ];

  return (
    <div className="studio">
      <aside className="st-sidebar">
        <div className="st-sidebar-top">
          <div className="st-logo" onClick={onBack}><span className="ln-logo-badge">RI</span> RIM AI</div>
          {NAV.map((s) => (
            <div key={s.section || 'home'}>
              {s.section && <div className="st-nav-section">{s.section}</div>}
              {s.items.map((it) => (
                <button key={it.id} className={`st-nav-item ${tool === it.id ? 'active' : ''}`} onClick={() => { setTool(it.id); setError(''); }}>
                  <I d={it.icon} s={18} /><span>{it.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="st-nav-section">ACCOUNT</div>
          <button className="st-nav-item"><I d="M12.2 2h-.4a2 2 0 00-2 2v.2a2 2 0 01-1 1.7l-.4.2a2 2 0 01-2 0l-.2-.1a2 2 0 00-2.7.7l-.2.4a2 2 0 00.7 2.7l.2.1a2 2 0 011 1.7v.5a2 2 0 01-1 1.8l-.2.1a2 2 0 00-.7 2.7l.2.4a2 2 0 002.7.7l.2-.1a2 2 0 012 0l.4.2a2 2 0 011 1.7v.2a2 2 0 002 2h.4a2 2 0 002-2v-.2a2 2 0 011-1.7l.4-.2a2 2 0 012 0l.2.1a2 2 0 002.7-.7l.2-.4a2 2 0 00-.7-2.7l-.2-.1a2 2 0 01-1-1.8v-.5a2 2 0 011-1.7l.2-.1a2 2 0 00.7-2.7l-.2-.4a2 2 0 00-2.7-.7l-.2.1a2 2 0 01-2 0l-.4-.2a2 2 0 01-1-1.7V4a2 2 0 00-2-2z" /><span>Settings</span></button>
        </div>
        <div className="st-sidebar-bottom">
          <div className="st-credits-label">AI Credits <span className="st-plan">{state.user.plan}</span></div>
          <div className="st-credits-text strong">{state.user.creditsUsed.toLocaleString()} <span>/ {state.user.creditsLimit.toLocaleString()}</span></div>
          <div className="st-credits-bar"><div className="st-credits-fill" style={{ width: `${creditPercent}%` }} /></div>
          <div className="st-credits-text">Resets in {state.user.resetDays} days</div>
          <button className="st-upgrade-btn">Upgrade Plan</button>
        </div>
      </aside>
      <div className="st-main">
        <header className="st-topbar">
          <select className="st-project-select" value={activeProject.id} onChange={(e) => loadStudioState(+e.target.value)}>
            {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="st-search"><I d="M21 21l-4.3-4.3M10 18a8 8 0 100-16 8 8 0 000 16z" s={16} /><input placeholder="Search projects, patterns, tools..." /><kbd>Ctrl K</kbd></div>
          <div className="st-user-actions">
            <button className="st-icon-btn"><I d="M18 8a6 6 0 00-12 0c0 7-3 7-3 7h18s-3 0-3-7M13.7 21a2 2 0 01-3.4 0" /></button>
            <button className="st-icon-btn"><I d="M9.1 9a3 3 0 115.8 1c0 2-3 2-3 4M12 17h.01" /></button>
            <div className="st-avatar">{state.user.initials}</div>
            <div className="st-user-meta"><strong>{state.user.name}</strong><span>{state.user.plan}</span></div>
          </div>
        </header>
        <div className={`st-workspace ${tool === 'library' || tool === 'exports' ? 'full-width' : ''}`}>
          <main className="st-center">
            <div className="st-page-head">
              <div>
                <h1 className="st-title">{toolLabel} {tool === 'library' && <span className="st-pro-badge">Pro</span>}</h1>
                <p>{tool === 'pattern' || tool === 'dashboard' ? 'Create, refine, and perfect repeat patterns with AI precision.' : tool === 'exports' ? 'View and download your recently exported assets.' : 'Upload artwork and generate print-ready assets.'}</p>
              </div>
              <div className="st-actions"><button>Save</button><button className="primary">Export</button></div>
            </div>
            {isLoadingState && <div className="st-error">Loading SQLite-backed studio state...</div>}
            {(tool !== 'dashboard' && tool !== 'exports') && (
              <div
                className={`st-upload ${isDrag ? 'dragging' : ''} ${preview ? 'has-image' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); setIsDrag(false); handleUpload(e.dataTransfer.files[0]); }}
                onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                onDragLeave={() => setIsDrag(false)}
              >
                {preview ? (
                  <div className="st-upload-preview"><img src={preview} alt="Uploaded" /><div><span className="st-upload-name">{uploaded?.originalName || 'Image'}</span><span className="st-upload-hint">Click to replace</span></div></div>
                ) : (
                  <div className="st-upload-empty"><I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /><span>Upload Image</span></div>
                )}
                <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handleUpload(e.target.files[0])} />
              </div>
            )}
            {renderCanvas()}
            {error && <div className="st-error">{error}</div>}
            {(tool === 'repeat' || tool === 'dashboard') && (
              <>
                <section className="st-variations">
                  <div className="st-section-title">Pattern Variations</div>
                  <div className="st-variation-row">
                    {state.variations.map((v) => (
                      <button 
                        key={v.id} 
                        className={`st-variation ${v.isSelected ? 'active' : ''}`}
                        onClick={() => {
                          setState(s => ({
                            ...s,
                            variations: s.variations.map(item => ({ ...item, isSelected: item.id === v.id })),
                            activeProject: { ...s.activeProject, heroImageUrl: v.imageUrl }
                          }));
                          setUploads(p => ({ ...p, [tool]: { file: null, url: v.imageUrl } }));
                        }}
                      >
                        <img src={v.imageUrl} alt="" />
                        <span>{v.name}</span>
                      </button>
                    ))}
                    <button className="st-generate-more"><span>+</span>Generate More</button>
                  </div>
                </section>
              </>
            )}

            {tool === 'dashboard' && (
                <section className="st-dashboard-grid">
                  <div className="st-card st-recent">
                    <div className="st-card-head"><strong>Recent Projects</strong><button>View all</button></div>
                    {state.projects.map((p) => (
                      <div 
                        key={p.id} 
                        className={`st-project-row ${activeProject.id === p.id ? 'active' : ''}`}
                        onClick={() => loadStudioState(p.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <img src={p.thumbnailUrl} alt="" />
                        <div><strong>{p.name}</strong><span>{p.updatedLabel}</span></div>
                        <em className={p.status.toLowerCase().replace(' ', '-')}>{p.status}</em>
                        <button onClick={(e) => e.stopPropagation()}>...</button>
                      </div>
                    ))}
                  </div>
                  <div className="st-card st-overview">
                    <div className="st-card-head"><strong>Project Overview</strong><button>This Week</button></div>
                    <div className="st-metrics">{metrics.map((m) => <div key={m[0]}><span>{m[0]}</span><strong>{Number(m[1]).toLocaleString()}</strong><em>+{m[2]}%</em><small>vs last week</small></div>)}</div>
                    {state.suggestion && <div className="st-suggestion"><I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" />{state.suggestion}<button>Apply</button></div>}
                  </div>
                </section>
            )}

            {repeatUrl && (
              <section className="st-generated-assets" style={{ marginTop: '24px', background: '#fff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <div className="st-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Generated Final Output</span>
                  <button className="st-icon-btn st-close-btn" onClick={() => setRepeatUrl(null)}><I d="M18 6L6 18M6 6l12 12" /></button>
                </div>
                <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', marginTop: '16px' }}>
                  <img src={repeatUrl} alt="Repeat Export" style={{ width: '400px', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <p style={{ color: '#64748b', fontSize: '14px', lineHeight: '1.5' }}>
                      Your seamlessly inpainted repeat set is ready. You can download the high-resolution tile and the generated seam mask.
                    </p>
                    <a href={repeatUrl} onClick={(e) => forceDownload(e, repeatUrl)} className="st-export-btn" style={{ textAlign: 'center', textDecoration: 'none' }}>Download High-Res Tile</a>
                    {repeatMaskUrl && <a href={repeatMaskUrl} onClick={(e) => forceDownload(e, repeatMaskUrl)} className="st-export-btn secondary" style={{ textAlign: 'center', textDecoration: 'none', background: '#f8fafc', color: '#0f172a', border: '1px solid #cbd5e1' }}>Download Mask Used</a>}
                  </div>
                </div>
              </section>
            )}
          </main>
          {tool !== 'library' && tool !== 'exports' && (
            <aside className="st-right-panel">{renderControls()}</aside>
          )}
        </div>
      </div>
    </div>
  );
}
