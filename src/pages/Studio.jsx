import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

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
  { section: '', items: [{ id: 'dashboard', label: 'Pipeline Studio', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }] },
  {
    section: 'AI DESIGN TOOLS',
    items: [
      { id: 'pattern', label: 'Pattern Extraction', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z' },
      { id: 'seamless', label: 'Make Seamless', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z' },
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
  const validTools = ['dashboard', 'pattern', 'seamless', 'repeat', 'inspire', 'vectorize', 'upscale', 'library', 'exports'];
  const [tool, _setTool] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    return validTools.includes(hash) ? hash : 'pattern';
  });
  const setTool = useCallback((t) => {
    _setTool(t);
    window.location.hash = t;
  }, []);
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
  const [inspireColors, setInspireColors] = useState(['#94b09e', '#e7dec2', '#dca5a2']);
  const [inspireStyle, setInspireStyle] = useState('All Styles');
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

  const [isSeamless, setIsSeamless] = useState(false);
  const [seamlessUrl, setSeamlessUrl] = useState(null);

  const [exportsList, setExportsList] = useState([]);
  const [isLoadingExports, setIsLoadingExports] = useState(false);
  const [selectedExports, setSelectedExports] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [exportsFilter, setExportsFilter] = useState('all'); // 'all' | 'image' | 'vector'

  const filteredExports = useMemo(() => {
    if (exportsFilter === 'all') return exportsList;
    return exportsList.filter(f => f.type === exportsFilter);
  }, [exportsList, exportsFilter]);

  const loadExports = useCallback(() => {
    setIsLoadingExports(true);
    fetch(`${API}/api/exports`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setExportsList(data.exports);
          setSelectedExports(new Set());
        }
      })
      .finally(() => setIsLoadingExports(false));
  }, []);

  useEffect(() => {
    if (tool === 'exports') loadExports();
  }, [tool, loadExports]);

  const toggleExportSelect = (id) => {
    setSelectedExports(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllExports = () => {
    const ids = filteredExports.map(f => f.id);
    if (ids.every(id => selectedExports.has(id))) {
      setSelectedExports(new Set());
    } else {
      setSelectedExports(new Set(ids));
    }
  };

  const deleteExports = async (filenames) => {
    if (!filenames.length) return;
    if (!window.confirm(`Delete ${filenames.length} file${filenames.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      await fetch(`${API}/api/exports`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames }),
      });
      loadExports();
    } catch {
      setError('Failed to delete files.');
    } finally {
      setIsDeleting(false);
    }
  };

  // ===== PIPELINE STUDIO =====
  const STEP_TYPES = [
    { type: 'upload', label: 'Upload Artwork', desc: 'PNG, JPG up to 10MB', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', credits: 0 },
    { type: 'extract', label: 'Pattern Extraction', desc: 'AI cleans & extracts pattern elements', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', credits: 20 },
    { type: 'seamless', label: 'Seamless Fix', desc: 'Creates seamless, tileable pattern', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', credits: 30 },
    { type: 'repeat', label: 'Repeat Set', desc: 'Generates repeat variations', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', credits: 10 },
    { type: 'upscale', label: 'High Resolution', desc: 'Upscale to 600 DPI print quality', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', credits: 40 },
    { type: 'vectorize', label: 'Vectorize', desc: 'Convert to scalable vector artwork', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', credits: 50 },
    { type: 'export', label: 'Export', desc: 'Choose formats & download', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', credits: 0 },
  ];

  const PIPELINE_TEMPLATES = [
    { id: 'extract', name: 'Pattern Extraction', desc: 'Extract patterns and clean artwork.', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', steps: ['upload', 'extract', 'export'] },
    { id: 'seamless', name: 'Make Seamless', desc: 'Remove seams and create tileable patterns.', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', steps: ['upload', 'seamless', 'export'] },
    { id: 'repeat', name: 'Repeat Set', desc: 'Generate half drop, brick, and more.', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', steps: ['upload', 'repeat', 'export'] },
    { id: 'upscale', name: 'Super Resolution', desc: 'Upscale for print with AI.', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', steps: ['upload', 'upscale', 'export'] },
    { id: 'vectorize', name: 'Vectorize', desc: 'Convert to scalable vector artwork.', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', steps: ['upload', 'vectorize', 'export'] },
    { id: 'full', name: 'Full Print Pipeline', desc: 'End-to-end workflow for print ready files.', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', steps: ['upload', 'extract', 'seamless', 'repeat', 'upscale', 'export'] },
  ];

  const getDefaultSettingsForStep = (type) => {
    if (type === 'repeat') return { gridSize: 3, repeatType: 'block' };
    if (type === 'upscale') return { upscaleFactor: 'x4' };
    if (type === 'export') return { outputFormat: 'PNG', resolution: 300 };
    return {};
  };

  const [pipelineSteps, setPipelineSteps] = useState(() => [
    { id: 'step_default_upload', type: 'upload', status: 'pending', resultUrl: null, settings: {} },
    { id: 'step_default_export', type: 'export', status: 'pending', resultUrl: null, settings: { outputFormat: 'PNG', resolution: 300 } }
  ]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineCurrentStep, setPipelineCurrentStep] = useState(-1);
  const [pipelineResults, setPipelineResults] = useState([]);
  const [pipelinePreview, setPipelinePreview] = useState(null);
  const [pipelineRuns, setPipelineRuns] = useState([]);
  const [pipelineFile, setPipelineFile] = useState(null); // uploaded file for pipeline
  const pipelineFileRef = useRef(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pipelineName, setPipelineName] = useState('My Custom Pipeline');
  const [savedProfiles, setSavedProfiles] = useState([]);
  const [dashboardTab, setDashboardTab] = useState('run'); // 'run' or 'build'
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Load pipeline runs and saved profiles on mount
  useEffect(() => {
    if (tool === 'dashboard' && activeProject?.id) {
      fetch(`${API}/api/pipeline-runs?project_id=${activeProject.id}`).then(r => r.json()).then(d => {
        if (d.success) setPipelineRuns(d.runs);
      }).catch(() => {});
      fetch(`${API}/api/workflows`).then(r => r.json()).then(d => {
        if (d.success) setSavedProfiles(d.workflows);
      }).catch(() => {});
    }
  }, [tool, activeProject?.id]);

  const loadProfile = (profile) => {
    const steps = profile.steps.map((type, i) => ({
      id: `step_${i}_${Date.now()}`,
      type,
      status: 'pending',
      resultUrl: null,
      settings: profile.settings[type] || getDefaultSettingsForStep(type),
    }));
    setPipelineSteps(steps);
    setPipelineResults([]);
    setPipelinePreview(null);
    setPipelineCurrentStep(-1);
    setPipelineName(profile.name);
  };

  const deleteProfile = async (id) => {
    if (!window.confirm('Are you sure you want to delete this profile?')) return;
    try {
      const r = await fetch(`${API}/api/workflows/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) {
        setSavedProfiles(prev => prev.filter(p => p.id !== id));
      }
    } catch {}
  };

  const runProfile = (profile) => {
    loadProfile(profile);
    setTimeout(() => {
      const el = document.querySelector('.st-pl-run-btn');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const selectTemplate = (tmpl) => {
    setSelectedTemplate(tmpl.id);
    const steps = tmpl.steps.map((type, i) => ({
      id: `step_${i}_${Date.now()}`,
      type,
      status: 'pending',
      resultUrl: null,
      settings: getDefaultSettingsForStep(type),
    }));
    setPipelineSteps(steps);
    setPipelineResults([]);
    setPipelinePreview(null);
    setPipelineCurrentStep(-1);
  };

  const addPipelineStep = (type) => {
    setError('');
    if (pipelineSteps.length === 0 && type !== 'upload') {
      setError('The first step in a pipeline must be an Upload step.');
      return;
    }
    if (type === 'upload' && pipelineSteps.length > 0) {
      setError('Upload must be the very first step.');
      return;
    }
    const hasVectorize = pipelineSteps.findIndex(s => s.type === 'vectorize');
    if (hasVectorize !== -1 && type === 'upscale') {
      setError('Invalid sequence: You cannot upscale a vectorized (SVG) image.');
      return;
    }

    setPipelineSteps(prev => {
      const copy = [...prev];
      const exportIdx = copy.findIndex(s => s.type === 'export');
      const newStep = {
        id: `step_${copy.length}_${Date.now()}`,
        type, status: 'pending', resultUrl: null, settings: getDefaultSettingsForStep(type),
      };
      if (exportIdx !== -1) {
        copy.splice(exportIdx, 0, newStep);
      } else {
        copy.push(newStep);
      }
      return copy;
    });
  };

  const removePipelineStep = (id) => {
    setPipelineSteps(prev => prev.filter(s => s.id !== id));
  };

  const updateStepSetting = (id, key, val) => {
    setPipelineSteps(prev => prev.map(s => s.id === id ? { ...s, settings: { ...s.settings, [key]: val } } : s));
  };

  const estimatedCredits = useMemo(() => {
    return pipelineSteps.reduce((sum, s) => {
      const def = STEP_TYPES.find(d => d.type === s.type);
      return sum + (def?.credits || 0);
    }, 0);
  }, [pipelineSteps]);

  const handlePipelineUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setPipelinePreview(e.target.result);
    reader.readAsDataURL(file);
    const fd = new FormData();
    fd.append('image', file);
    fetch(`${API}/api/upload`, { method: 'POST', body: fd })
      .then(r => r.json())
      .then(d => { if (d.success) setPipelineFile(d); })
      .catch(() => setError('Upload failed'));
  };

  const runPipeline = async () => {
    if (pipelineSteps.length === 0) return;
    setError('');
    
    const hasUpload = pipelineSteps[0]?.type === 'upload';
    if (!hasUpload) {
      setError('Pipeline must start with an Upload step.');
      return;
    }
    if (hasUpload && !pipelineFile) {
      setError('Please upload an image first.');
      return;
    }
    
    const vecIdx = pipelineSteps.findIndex(s => s.type === 'vectorize');
    const upIdx = pipelineSteps.findIndex(s => s.type === 'upscale');
    if (vecIdx !== -1 && upIdx !== -1 && upIdx > vecIdx) {
      setError('Invalid pipeline: You cannot upscale a vectorized (SVG) image. Please upscale before vectorizing.');
      return;
    }

    setPipelineRunning(true);
    setError('');
    const results = [];
    let currentInput = pipelineFile?.filename || '';

    const exportStep = pipelineSteps.find(s => s.type === 'export');
    const outFormat = exportStep?.settings?.outputFormat || 'PNG';
    const outDpi = exportStep?.settings?.resolution || 300;

    // Create run record
    let runId = null;
    try {
      const rr = await fetch(`${API}/api/pipeline-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          name: PIPELINE_TEMPLATES.find(t => t.id === selectedTemplate)?.name || 'Custom Pipeline',
          steps: pipelineSteps.map(s => s.type),
          settings: pipelineSteps.reduce((acc, s) => ({ ...acc, [s.type]: s.settings }), {}),
        }),
      });
      const rd = await rr.json();
      if (rd.success) runId = rd.runId;
    } catch {}

    // Step-by-step execution
    for (let i = 0; i < pipelineSteps.length; i++) {
      const step = pipelineSteps[i];
      setPipelineCurrentStep(i);
      setPipelineSteps(prev => prev.map((s, idx) =>
        idx === i ? { ...s, status: 'running' } : s
      ));

      try {
        let resultUrl = null;
        if (step.type === 'upload') {
          // Already handled by handlePipelineUpload
          resultUrl = pipelineFile ? `${API}/uploads/${pipelineFile.filename}` : null;
        } else if (step.type === 'extract') {
          const r = await fetch(`${API}/api/extract-design`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: activeProject.id, filename: currentInput }),
          });
          const d = await r.json();
          if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); }
          else throw new Error(d.error || 'Extraction failed');
        } else if (step.type === 'seamless') {
          const r = await fetch(`${API}/api/make-seamless`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: activeProject.id, filename: currentInput }),
          });
          const d = await r.json();
          if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); }
          else throw new Error(d.error || 'Seamless failed');
        } else if (step.type === 'repeat') {
          const r = await fetch(`${API}/api/create-repeat-set`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: activeProject.id, filename: currentInput,
              gridSize: step.settings?.gridSize || 3, scale: 100,
              repeatType: step.settings?.repeatType || 'block',
              dpi: outDpi, format: outFormat,
            }),
          });
          const d = await r.json();
          if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); }
          else throw new Error(d.error || 'Repeat failed');
        } else if (step.type === 'upscale') {
          const r = await fetch(`${API}/api/upscale`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, factor: step.settings?.upscaleFactor || 'x4' }),
          });
          const d = await r.json();
          if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); }
          else throw new Error(d.error || 'Upscale failed');
        } else if (step.type === 'vectorize') {
          const r = await fetch(`${API}/api/vectorize`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: activeProject.id, filename: currentInput }),
          });
          const d = await r.json();
          if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); }
          else throw new Error(d.error || 'Vectorize failed');
        } else if (step.type === 'export') {
          // Export is just the final download
          resultUrl = currentInput ? `${API}/results/${currentInput}` : null;
        }

        results.push({ step: i, type: step.type, status: 'done', resultUrl });
        setPipelineResults([...results]);
        if (resultUrl) setPipelinePreview(resultUrl);
        setPipelineSteps(prev => prev.map((s, idx) =>
          idx === i ? { ...s, status: 'done', resultUrl } : s
        ));
      } catch (err) {
        results.push({ step: i, type: step.type, status: 'error', error: err.message });
        setPipelineResults([...results]);
        setPipelineSteps(prev => prev.map((s, idx) =>
          idx === i ? { ...s, status: 'error' } :
          idx > i ? { ...s, status: 'skipped' } : s
        ));
        setError(`Step "${STEP_TYPES.find(d => d.type === step.type)?.label}" failed: ${err.message}`);
        break;
      }
    }

    // Update run record
    const finalStatus = results.every(r => r.status === 'done') ? 'completed' : 'failed';
    if (runId) {
      fetch(`${API}/api/pipeline-runs/${runId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: finalStatus, results }),
      }).catch(() => {});
    }
    // Refresh runs list
    fetch(`${API}/api/pipeline-runs`).then(r => r.json()).then(d => {
      if (d.success) setPipelineRuns(d.runs);
    }).catch(() => {});

    setPipelineRunning(false);
    setPipelineCurrentStep(-1);
  };

  const savePipelineProfile = async () => {
    if (!pipelineName.trim()) {
      alert('Please enter a name for your pipeline profile.');
      return;
    }
    try {
      const rr = await fetch(`${API}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: pipelineName.trim(),
          steps: pipelineSteps.map(s => s.type),
          settings: pipelineSteps.reduce((acc, s) => ({ ...acc, [s.type]: s.settings }), {}),
        }),
      });
      const rd = await rr.json();
      if (rd.success) {
        alert('Pipeline profile saved successfully!');
        setSavedProfiles([{
          id: rd.workflowId,
          name: pipelineName.trim(),
          steps: pipelineSteps.map(s => s.type),
          settings: pipelineSteps.reduce((acc, s) => ({ ...acc, [s.type]: s.settings }), {}),
        }, ...savedProfiles]);
      } else {
        alert('Failed to save pipeline profile.');
      }
    } catch (err) {
      alert('Error connecting to server.');
    }
  };
  // ===== END PIPELINE =====

  const [repeatTab, setRepeatTab] = useState('canvas');
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showTileBoundary, setShowTileBoundary] = useState(true);

  const handleWheel = (e) => {
    setCanvasZoom(z => Math.max(0.1, Math.min(5, z - e.deltaY * 0.001)));
  };
  const handleMouseDown = (e) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - canvasPan.x, y: e.clientY - canvasPan.y });
  };
  const handleMouseMove = (e) => {
    if (!isPanning) return;
    setCanvasPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };
  const handleMouseUp = () => setIsPanning(false);

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
      // Use full source image resolution for crisp preview
      const tw = img.width;
      const th = img.height;
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
            ctx.translate(
              col * tw + (Math.abs(col) % 2 ? drawW : 0),
              r * th + (Math.abs(r) % 2 ? drawH : 0)
            );
            ctx.scale(Math.abs(col) % 2 ? -1 : 1, Math.abs(r) % 2 ? -1 : 1);
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
      if (controls.edgeMatch && (controls.hBrush > 0 || controls.vBrush > 0)) {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.35)'; // Purple/Indigo overlay
        
        // hBrush and vBrush are now percentages (0-25) representing Tile Overlap
        // We calculate the pixel width relative to the scaled tile width/height
        const displayHBrush = tw * (controls.hBrush / 100);
        const displayVBrush = th * (controls.vBrush / 100);
        
        // Ensure we draw the grid seams over the entire expanded area
        for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
          if (displayHBrush > 0) {
            // Horizontal seams (between rows)
            // Adjust for staggered layouts
            if (controls.repeatType === 'half_drop') {
              for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
                const offset = Math.abs(col) % 2 ? Math.floor(th / 2) : 0;
                const y = r * th + offset;
                ctx.fillRect(col * tw, y - displayHBrush / 2, tw, displayHBrush);
              }
            } else {
              const y = r * th;
              ctx.fillRect(-expand * tw, y - displayHBrush / 2, (controls.gridSize + expand * 2) * tw, displayHBrush);
            }
          }
        }
        for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
          if (displayVBrush > 0) {
            // Vertical seams (between cols)
            if (controls.repeatType === 'half_brick') {
              for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
                const offset = Math.abs(r) % 2 ? Math.floor(tw / 2) : 0;
                const x = col * tw + offset;
                ctx.fillRect(x - displayVBrush / 2, r * th, displayVBrush, th);
              }
            } else {
              const x = col * tw;
              ctx.fillRect(x - displayVBrush / 2, -expand * th, displayVBrush, (controls.gridSize + expand * 2) * th);
            }
          }
        }
      }

      ctx.restore();
    };
    const imgSrc = preview;
    if (!imgSrc) {
      // No uploaded image — show blank canvas
      c.width = 980;
      c.height = 680;
      ctx.fillStyle = '#fbfaf7';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Upload an image to preview your repeat set', c.width / 2, c.height / 2);
      return;
    }
    img.src = imgSrc;
  }, [controls, preview]);

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
      let finalPrompt = prompt;
      if (inspireStyle !== 'All Styles' && !finalPrompt.toLowerCase().includes(inspireStyle.toLowerCase())) {
        finalPrompt += `, ${inspireStyle} style`;
      }
      if (inspireColors.length > 0) {
        finalPrompt += `, color palette: ${inspireColors.join(', ')}`;
      }

      const r = await fetch(`${API}/api/generate-inspirations`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          prompt: finalPrompt, 
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

  const createRepeat = async () => {
    if (!uploaded && !preview) {
      setError('Upload an image first to export a repeat set.');
      return;
    }

    let safeFilename = uploaded?.filename || '';
    let safeUrl = '';

    // If no filename from upload response, try to extract from preview URL
    if (!safeFilename && preview) {
      if (preview.startsWith('data:')) {
        // It's a base64 data URL from FileReader — we need the server filename
        setError('Image is still uploading. Please wait and try again.');
        return;
      } else if (preview.startsWith('http')) {
        safeUrl = preview;
      } else {
        // Local path like /uploads/xxx.png or /results/xxx.png
        safeFilename = preview.split('/').pop();
      }
    }

    if (!safeFilename && !safeUrl) {
      setError('No valid image to export. Please upload an image.');
      return;
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
          scale: controls.scale,
          repeatType: controls.repeatType,
          dpi: controls.exportDpi,
          format: controls.exportFormat,
        }),
      });
      const d = await r.json();
      if (d.success) {
        const fullUrl = `${API}${d.resultUrl}`;
        setRepeatUrl(fullUrl);
        // Force a real download using fetch+blob
        forceDownload({ preventDefault: () => {} }, fullUrl);
      } else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsRepeat(false);
    }
  };

  const extractDesign = async () => {
    const activeUrl = preview || activeProject.heroImageUrl;
    if (!uploaded && !activeUrl) {
      setError('Upload an image first');
      return;
    }

    let safeFilename = uploaded?.filename;
    let safeUrl = !uploaded ? activeUrl : null;

    if (!safeFilename && safeUrl && !safeUrl.startsWith('http')) {
      safeFilename = safeUrl.split('/').pop();
      safeUrl = null;
    }

    setIsEnh(true);
    setError('');
    setEnhUrl(null);
    try {
      const r = await fetch(`${API}/api/extract-design`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ filename: safeFilename, imageUrl: safeUrl, projectId: activeProject.id }) 
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

  const makeSeamless = async () => {
    const activeUrl = preview || activeProject.heroImageUrl;
    if (!uploaded && !activeUrl) {
      setError('Upload an image first');
      return;
    }

    let safeFilename = uploaded?.filename;
    let safeUrl = !uploaded ? activeUrl : null;

    if (!safeFilename && safeUrl && !safeUrl.startsWith('http')) {
      safeFilename = safeUrl.split('/').pop();
      safeUrl = null;
    }

    setIsSeamless(true);
    setError('');
    setSeamlessUrl(null);
    try {
      const r = await fetch(`${API}/api/make-seamless`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          filename: safeFilename, 
          imageUrl: safeUrl, 
          projectId: activeProject.id, 
          hBrushPct: controls.hBrush, 
          vBrushPct: controls.vBrush 
        }) 
      });
      const d = await r.json();
      if (d.success) {
        setSeamlessUrl(`${API}${d.resultUrl}`);
        // Optionally update the active project image or trigger reload
      } else setError(d.error);
    } catch {
      setError('Backend is not reachable. Start Flask on port 3001.');
    } finally {
      setIsSeamless(false);
    }
  };

  const toolLabel = {
    dashboard: 'Pipeline Studio',
    pattern: 'Pattern Extraction',
    seamless: 'Make Seamless',
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

  const renderVariations = (isSidebar = false) => {
    if (state.variations.length === 0) return null;
    return (
      <section className={`st-variations ${isSidebar ? 'st-side-variations' : ''}`}>
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
          <button className="st-generate-more"><span>+</span><small>Generate More</small></button>
        </div>
      </section>
    );
  };

  const renderControls = () => {
    if (tool === 'repeat') {
      return (
        <div className="st-ctrl">
              <div className="st-settings-group">
                <div className="st-group-title">TILE SETTINGS</div>
                <label className="st-label">Grid Size</label>
                <div className="st-btn-row">
                  {['2x2', '3x3', '4x4', '5x5', '6x6'].map((n, i) => (
                    <button key={n} className={`st-grid-btn ${controls.gridSize === i + 2 ? 'active' : ''}`} onClick={() => updateControls({ gridSize: i + 2 })}>{n}</button>
                  ))}
                </div>

                <label className="st-label">Scale</label>
                <div className="st-scale-row">
                  <button onClick={() => updateControls({ scale: Math.max(50, controls.scale - 10) })}>-</button>
                  <span style={{ flex: 1, textAlign: 'center' }}>{controls.scale}%</span>
                  <button onClick={() => updateControls({ scale: Math.min(200, controls.scale + 10) })}>+</button>
                </div>
                
                <label className="st-label">Rotation</label>
                <div className="st-scale-row">
                  <button onClick={() => updateControls({ rotation: (controls.rotation - 15 + 360) % 360 })}>0&deg;</button>
                  <span style={{ flex: 1, textAlign: 'center' }}>{controls.rotation}&deg;</span>
                  <button onClick={() => updateControls({ rotation: (controls.rotation + 15) % 360 })}>+</button>
                </div>
                
                <label className="st-label">Mirror</label>
                <div className="st-btn-row">
                  <button className={`st-sym-btn ${controls.repeatType === 'block' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'block' })} title="None"><I d="M3 3h18v18H3z" s={14} /></button>
                  <button className={`st-sym-btn ${controls.repeatType === 'mirror' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'mirror' })} title="Horizontal"><I d="M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4" s={14} /></button>
                  <button className={`st-sym-btn ${controls.repeatType === 'half_drop' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'half_drop' })} title="Vertical"><I d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" s={14} /></button>
                </div>
              </div>
          <div className="st-settings-group">
            <div className="st-group-title">EXPORT OPTIONS</div>
            <div className="st-export-grid">
              <div><label className="st-label-sm">Format</label><select value={controls.exportFormat} onChange={(e) => updateControls({ exportFormat: e.target.value })} className="st-select"><option>PNG</option><option>JPG</option><option>TIFF</option></select></div>
              <div><label className="st-label-sm">Resolution</label><select value={controls.exportDpi} onChange={(e) => updateControls({ exportDpi: +e.target.value })} className="st-select"><option value={150}>150 DPI</option><option value={300}>300 DPI</option><option value={600}>600 DPI</option></select></div>
            </div>
          </div>
          <button className="st-export-btn" onClick={() => createRepeat()} disabled={isRepeat || (!uploaded && !preview)}>{isRepeat ? 'Processing...' : 'Export Repeat Set'}</button>
          {renderVariations(true)}
        </div>
      );
    }
    if (tool === 'inspire') return (
      <div className="st-ctrl" style={{ padding: '0.25rem' }}>

        <div className="st-inspire-sidebar-group">
          <div className="st-inspire-sidebar-label">Creativity <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
          <input type="range" min="1" max="5" value={creativity} onChange={(e) => setCreativity(+e.target.value)} className="st-range" />
          <div className="st-range-labels"><span>Safe</span><span>Wild</span></div>
        </div>

        <div className="st-inspire-sidebar-group">
          <div className="st-inspire-sidebar-label">Variants <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
          <div className="st-btn-row">
            {[1, 3, 5, 7].map((n) => <button key={n} className={`st-grid-btn ${variants === n ? 'active' : ''}`} onClick={() => setVariants(n)}>{n}</button>)}
          </div>
        </div>

        <div className="st-inspire-sidebar-group">
          <div className="st-inspire-sidebar-label">Color Mood <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
          <div className="st-color-mood">
            <button className="st-color-btn" onClick={() => {
              const hex = prompt('Enter a hex color code (e.g. #ff0000):');
              if (hex && /^#[0-9A-F]{6}$/i.test(hex.trim())) {
                setInspireColors([...inspireColors, hex.trim()]);
              } else if (hex) {
                alert('Please enter a valid 6-digit hex code starting with #');
              }
            }} title="Add Color"><I d="M12 5v14M5 12h14" s={16} /></button>
            {inspireColors.map((c, i) => (
              <div 
                key={i} 
                className="st-color-circle" 
                style={{ background: c, cursor: 'pointer' }} 
                onClick={() => setInspireColors(inspireColors.filter((_, idx) => idx !== i))}
                title="Click to remove"
              />
            ))}
          </div>
        </div>

        <div className="st-inspire-sidebar-group">
          <div className="st-inspire-sidebar-label">Style <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
          <div className="st-style-tags">
            {['All Styles', 'Hand Painted', 'Minimal', 'Line Art', 'Vintage', 'Geometric'].map(s => (
              <button 
                key={s} 
                className={`st-style-tag ${inspireStyle === s ? 'active' : ''}`} 
                onClick={() => setInspireStyle(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '2rem' }}>
          <button className="st-generate-btn-lg" onClick={generate} disabled={isGen}>
            <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={18} />
            {isGen ? 'Generating...' : 'Generate Variations'}
          </button>
          <p className="st-generate-hint"><I d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" s={12} /> Uses {variants} credits</p>
        </div>
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
    if (tool === 'seamless') return (
      <div className="st-pattern-right">
        <div className="st-pattern-right-title">
          <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={20} />
          Make Seamless
        </div>
        <p className="st-pattern-right-desc">
          Automatically offset your base tile and let AI inpaint the seams to create a perfectly repeatable pattern.
        </p>
        <button className="st-pattern-right-btn" onClick={makeSeamless} disabled={isSeamless || (!uploaded && !preview && !activeProject?.heroImageUrl)}>
          <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={16} />
          {isSeamless ? 'Fixing Seams...' : 'Make Seamless Base Tile'}
        </button>
      </div>
    );
    if (tool === 'pattern') return (
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
    );
  };

  const renderCanvas = () => {
    if (tool === 'dashboard') {
      return (
        <div className="st-pipeline-studio">
          <div className="st-pl-tabs">
            <button className={`st-pl-tab ${dashboardTab === 'run' ? 'active' : ''}`} onClick={() => setDashboardTab('run')}>
              <I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={18} /> My Workflows
            </button>
            <button className={`st-pl-tab ${dashboardTab === 'build' ? 'active' : ''}`} onClick={() => setDashboardTab('build')}>
              <I d="M12 5v14M5 12h14" s={18} /> Workflow Builder
            </button>
          </div>

          {/* Saved Profiles */}
          {dashboardTab === 'run' && savedProfiles.length > 0 && (
            <div className="st-pl-section" style={{marginBottom: '1.25rem'}}>
              <h2 className="st-pl-section-num">Saved Workflows</h2>
              <div className="st-pl-templates">
                {savedProfiles.map(profile => (
                  <div
                    key={profile.id}
                    className="st-pl-template-card profile-card"
                    onClick={() => loadProfile(profile)}
                  >
                    <div className="st-pl-template-icon"><I d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" s={22} /></div>
                    <strong>{profile.name}</strong>
                    <span>{profile.steps.length} steps configured</span>
                    <div className="st-pl-profile-actions">
                      <button onClick={(e) => { e.stopPropagation(); runProfile(profile); }} title="Run"><I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={14} /></button>
                      <button onClick={(e) => { e.stopPropagation(); loadProfile(profile); }} title="Edit"><I d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" s={14} /></button>
                      <button className="danger" onClick={(e) => { e.stopPropagation(); deleteProfile(profile.id); }} title="Delete"><I d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" s={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dashboardTab === 'run' && savedProfiles.length === 0 && (
            <div className="st-pl-section" style={{marginBottom: '1.25rem', textAlign: 'center', padding: '3rem 1rem'}}>
              <h2 style={{color: '#344054', marginBottom: '0.5rem'}}>No workflows found</h2>
              <p style={{color: '#6b7280', fontSize: '0.9rem'}}>Go to the Workflow Builder tab to create and save a custom pipeline!</p>
            </div>
          )}

          {/* Section 1: Available Tools */}
          {dashboardTab === 'build' && (
            <div className="st-pl-section" style={{marginBottom: '1.25rem'}}>
              <h2 className="st-pl-section-num">Add Tools to Pipeline</h2>
            <div className="st-pl-templates">
              {STEP_TYPES.filter(t => t.type !== 'upload' && t.type !== 'export').map(toolDef => (
                <div
                  key={toolDef.type}
                  className="st-pl-template-card draggable"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('stepType', toolDef.type);
                  }}
                  onClick={() => addPipelineStep(toolDef.type)}
                >
                  <div className="st-pl-template-icon"><I d={toolDef.icon} s={22} /></div>
                  <strong>{toolDef.label}</strong>
                  <span>{toolDef.desc}</span>
                  <div className="st-pl-drag-hint"><I d="M12 5v14M5 12h14" s={14} /> Add</div>
                </div>
              ))}
            </div>
            <p style={{fontSize: '0.75rem', color: '#6b7280', marginTop: '1rem', textAlign: 'center'}}>
              Click a tool or drag it into the builder below to insert it into your pipeline.
            </p>
          </div>
          )}

          {/* Section 2: Build Your Pipeline */}
          <div className="st-pl-section">
            <h2 className="st-pl-section-num">{dashboardTab === 'build' ? 'Build Your Pipeline' : 'Pipeline Configuration'}</h2>
            <div 
              className={`st-pl-builder ${isDraggingOver && dashboardTab === 'build' ? 'drag-over' : ''}`}
              onDragOver={dashboardTab === 'build' ? (e) => { e.preventDefault(); setIsDraggingOver(true); } : undefined}
              onDragLeave={dashboardTab === 'build' ? () => setIsDraggingOver(false) : undefined}
              onDrop={dashboardTab === 'build' ? (e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const type = e.dataTransfer.getData('stepType');
                if (type) addPipelineStep(type);
              } : undefined}
            >
              {pipelineSteps.map((step, i) => {
                const def = STEP_TYPES.find(d => d.type === step.type);
                const isUploadStep = step.type === 'upload';
                const uploadDone = isUploadStep && pipelineFile;
                return (
                  <React.Fragment key={step.id}>
                    {i > 0 && <div className={`st-pl-connector ${step.status === 'done' || (i === 1 && uploadDone) ? 'done' : ''}`}><I d="M9 5l7 7-7 7" s={14} /></div>}
                    <div
                      className={`st-pl-step ${uploadDone ? 'done' : step.status}`}
                      onClick={() => {
                        if (isUploadStep) pipelineFileRef.current?.click();
                        else if (step.resultUrl) setPipelinePreview(step.resultUrl);
                      }}
                    >
                      <div className="st-pl-step-icon"><I d={def?.icon || ''} s={20} /></div>
                      <div className="st-pl-step-label">{def?.label}</div>
                      <div className="st-pl-step-desc">
                        {isUploadStep && pipelineFile ? pipelineFile.originalName || 'Uploaded' : def?.desc}
                        {step.type === 'repeat' && (
                          <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.gridSize || 3} onChange={e => updateStepSetting(step.id, 'gridSize', parseInt(e.target.value))}>
                            <option value="2">2x2 Grid</option>
                            <option value="3">3x3 Grid</option>
                            <option value="4">4x4 Grid</option>
                            <option value="6">6x6 Grid</option>
                          </select>
                        )}
                        {step.type === 'upscale' && (
                          <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.upscaleFactor || 'x4'} onChange={e => updateStepSetting(step.id, 'upscaleFactor', e.target.value)}>
                            <option value="x2">2x Upscale</option>
                            <option value="x4">4x Upscale</option>
                          </select>
                        )}
                        {step.type === 'export' && (
                          <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.outputFormat || 'PNG'} onChange={e => updateStepSetting(step.id, 'outputFormat', e.target.value)}>
                            <option value="PNG">PNG Output</option>
                            <option value="JPG">JPG Output</option>
                            <option value="TIFF">TIFF Output</option>
                          </select>
                        )}
                      </div>
                      {(uploadDone || step.status === 'done') && <div className="st-pl-step-badge done"><I d="M5 13l4 4L19 7" s={12} /></div>}
                      {step.status === 'running' && <div className="st-pl-step-badge running"><div className="st-spinner" style={{width:14,height:14,borderWidth:2}} /></div>}
                      {step.status === 'error' && <div className="st-pl-step-badge error"><I d="M6 18L18 6M6 6l12 12" s={12} /></div>}
                      {!pipelineRunning && !isUploadStep && step.type !== 'export' && dashboardTab === 'build' && (
                        <button className="st-pl-step-remove" onClick={(e) => { e.stopPropagation(); removePipelineStep(step.id); }}>×</button>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
              {/* {!pipelineRunning && (
                <div className="st-pl-add-wrapper">
                  <button className="st-pl-add-btn" onClick={() => setShowAddMenu(!showAddMenu)}>
                    <I d="M12 5v14M5 12h14" s={16} /> Add Step
                  </button>
                  {showAddMenu && (
                    <div className="st-pl-add-menu">
                      {STEP_TYPES.filter(t => t.type !== 'upload' && t.type !== 'export').map(t => (
                        <button key={t.type} className="st-pl-add-item" onClick={() => { addPipelineStep(t.type); setShowAddMenu(false); }}>
                          <I d={t.icon} s={16} /> {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )} */}
            </div>
          </div>

          {/* Section 3: Run Pipeline */}
          <div className="st-pl-run-section">
            {dashboardTab === 'build' ? (
              <input 
                type="text" 
                className="st-pl-name-input" 
                value={pipelineName} 
                onChange={e => setPipelineName(e.target.value)} 
                placeholder="Name your pipeline..." 
              />
            ) : <div style={{flex:1}} />}
            <div className="st-pl-run-area">
              <div className="st-pl-credits">Estimated Credits: <strong>{estimatedCredits}</strong></div>
              {dashboardTab === 'build' && (
                <button className="st-pl-save-btn" onClick={savePipelineProfile} disabled={pipelineRunning || pipelineSteps.length <= 2}>
                  <I d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" s={18} /> Save Profile
                </button>
              )}
              <button className="st-pl-run-btn" disabled={pipelineRunning || pipelineSteps.length === 0} onClick={runPipeline}>
                {pipelineRunning ? <><div className="st-spinner" style={{width:16,height:16,borderWidth:2}} /> Running...</> : <><I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={18} /> Run Pipeline</>}
              </button>
            </div>
          </div>

          {/* Pipeline upload for first step */}
          {pipelineSteps.length > 0 && pipelineSteps[0]?.type === 'upload' && !pipelineFile && (
            <div className="st-pl-upload-prompt" onClick={() => pipelineFileRef.current?.click()}>
              <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={24} />
              <strong>Upload your artwork to get started</strong>
              <span>PNG, JPG up to 10MB</span>
            </div>
          )}
          <input ref={pipelineFileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handlePipelineUpload(e.target.files[0])} />
        </div>
      );
    }
    if (tool === 'repeat') {
      return (
        <div className="st-repeat-layout">
            <div className="st-repeat-board">
              <div className="st-repeat-toolbar">
                <div className="st-tb-group">
                  <button className={`st-tb-btn ${isPanning ? 'active' : ''}`}><I d="M10 20l-4-4m0 0l4-4m-4 4h14M14 4l4 4m0 0l-4 4m4-4H4" s={16} /></button>
                  <button className="st-tb-btn"><I d="M12 5v14M5 12h14" s={16} /></button>
                </div>
                <div className="st-tb-group">
                  <button className="st-tb-btn" onClick={() => setCanvasZoom(z => Math.max(0.1, z - 0.1))}><I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" s={16} /></button>
                  <input type="range" min="0.1" max="3" step="0.05" value={canvasZoom} onChange={(e) => setCanvasZoom(parseFloat(e.target.value))} className="st-zoom-slider" />
                  <span className="st-zoom-text">{Math.round(canvasZoom * 100)}%</span>
                  <button className="st-tb-btn" onClick={() => {setCanvasZoom(1); setCanvasPan({x:0,y:0})}} title="Fit to Screen"><I d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" s={16} /></button>
                  <button className="st-tb-btn active" title="Grid"><I d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" s={16} /></button>
                </div>
                <button className={`st-tb-btn-text ${showTileBoundary ? 'active' : ''}`} onClick={() => setShowTileBoundary(!showTileBoundary)}>
                  <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={16} /> Show Tile Boundary
                </button>
              </div>
              <div 
                className="st-repeat-canvas-container" 
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <div 
                  className="st-repeat-canvas-wrapper" 
                  style={{ transform: `translate(-50%, -50%) translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})` }}
                >
                  <canvas ref={canvasRef} className="st-canvas-free" style={{ border: showTileBoundary ? '1px dashed #6366f1' : 'none' }} />
                </div>
              </div>
              <div className="st-repeat-footer">
                <span className="st-res-text">4096px &times; 3072px</span>
                <div className="st-footer-actions">
                  <button><I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={14} /></button>
                  <button><I d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" s={14} /></button>
                </div>
              </div>
            </div>
        </div>
      );
    }
    if (tool === 'exports') {
      const imageCount = exportsList.filter(f => f.type === 'image').length;
      const vectorCount = exportsList.filter(f => f.type === 'vector').length;
      return (
        <div className="st-inspire-canvas">
          {isLoadingExports ? (
            <div className="st-loading"><div className="st-spinner" /><span>Loading exports...</span></div>
          ) : exportsList.length > 0 ? (
            <>
              <div className="st-exports-toolbar">
                <div className="st-exports-toolbar-left">
                  <label className="st-exports-select-all">
                    <input
                      type="checkbox"
                      checked={filteredExports.length > 0 && filteredExports.every(f => selectedExports.has(f.id))}
                      onChange={selectAllExports}
                    />
                    <span>{selectedExports.size > 0 ? `${selectedExports.size} selected` : 'Select all'}</span>
                  </label>
                  {selectedExports.size > 0 && (
                    <button
                      className="st-exports-delete-btn"
                      onClick={() => deleteExports([...selectedExports])}
                      disabled={isDeleting}
                    >
                      <I d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" s={14} />
                      {isDeleting ? 'Deleting...' : `Delete ${selectedExports.size}`}
                    </button>
                  )}
                </div>
                <select className="st-exports-filter" value={exportsFilter} onChange={(e) => setExportsFilter(e.target.value)}>
                  <option value="all">All Files ({exportsList.length})</option>
                  <option value="image">Images ({imageCount})</option>
                  <option value="vector">Vectors ({vectorCount})</option>
                </select>
              </div>
              {filteredExports.length > 0 ? (
                <div className="st-var-grid">
                  {filteredExports.map((file) => {
                    const fullUrl = file.imageUrl.startsWith('http') ? file.imageUrl : `${API}${file.imageUrl}`;
                    const previewSrc = (file.previewUrl || file.imageUrl).startsWith('http')
                      ? (file.previewUrl || file.imageUrl)
                      : `${API}${file.previewUrl || file.imageUrl}`;
                    const isSelected = selectedExports.has(file.id);
                    return (
                      <div key={file.id} className={`st-var-item ${isSelected ? 'selected' : ''}`}>
                        <div className="st-export-check" onClick={() => toggleExportSelect(file.id)}>
                          <input type="checkbox" checked={isSelected} readOnly />
                        </div>
                        <img src={previewSrc} alt={file.id} loading="lazy" />
                        <div className="st-export-meta">
                          <span className={`st-export-badge ${file.type}`}>{file.format}</span>
                          <span className="st-export-size">{file.size}</span>
                        </div>
                        <div className="st-export-actions">
                          <a href={fullUrl} onClick={(e) => forceDownload(e, fullUrl)} className="st-dl-btn" title="Download">Download</a>
                          <button
                            className="st-export-trash"
                            title="Delete"
                            onClick={() => deleteExports([file.id])}
                            disabled={isDeleting}
                          >
                            <I d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" s={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="st-empty-canvas"><span className="st-empty-icon">🔍</span><p>No {exportsFilter === 'vector' ? 'vector' : 'image'} files found.</p></div>
              )}
            </>
          ) : (
            <div className="st-empty-canvas"><span className="st-empty-icon">📁</span><p>No exports generated yet for this project.</p></div>
          )}
        </div>
      );
    }
    if (tool === 'pattern') {
      const loading = isEnh;
      return (
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
                    <rect x="25" y="30" width="60" height="65" rx="8" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="2" transform="rotate(-10 25 30)"/>
                    <rect x="40" y="25" width="60" height="65" rx="8" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2"/>
                    <circle cx="55" cy="45" r="6" fill="#E5E7EB"/>
                    <path d="M40 70L55 55L75 75L85 65L100 80" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                         <img src={url} alt={`Result ${i+1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '8px' }} />
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
                    <rect x="35" y="30" width="60" height="60" rx="8" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="2" strokeDasharray="4 4"/>
                    <path d="M50 45C50 45 55 50 60 45C65 40 70 45 70 45" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M45 60C45 60 50 55 55 60C60 65 65 60 65 60" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M55 75C55 75 60 70 65 75C70 80 75 75 75 75" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M75 55L75 60M85 30L90 35M30 75L25 70" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round"/>
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
      );
    }
    if (tool === 'seamless') {
      const loading = isSeamless;
      return (
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
            <p>JPG, PNG &bull; Up to 50MB</p>
          </div>

          <div className="st-pattern-panels">
            <div className="st-pattern-panel">
              <div className="st-pattern-panel-label">Original</div>
              {preview ? (
                <img src={preview} alt="Original" className="st-pattern-image" />
              ) : (
                <>
                  <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="25" y="30" width="60" height="65" rx="8" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="2" transform="rotate(-10 25 30)"/>
                    <rect x="40" y="25" width="60" height="65" rx="8" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2"/>
                    <circle cx="55" cy="45" r="6" fill="#E5E7EB"/>
                    <path d="M40 70L55 55L75 75L85 65L100 80" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div className="st-pattern-empty-title">No image uploaded</div>
                </>
              )}
            </div>

            <div className="st-pattern-arrow">
              <I d="M5 12h14M12 5l7 7-7 7" s={18} />
            </div>

            <div className="st-pattern-panel">
              <div className="st-pattern-panel-label">Seamless Base Tile</div>
              {seamlessUrl ? (
                <>
                  <img src={seamlessUrl} alt="Result" className="st-pattern-image" />
                  <a href={seamlessUrl} onClick={(e) => forceDownload(e, seamlessUrl)} className="st-dl-btn" style={{ position: 'absolute', bottom: '1rem', right: '1rem' }}>Download</a>
                </>
              ) : loading ? (
                <div className="st-loading"><div className="st-spinner" /><span>Fixing seams...</span></div>
              ) : (
                <>
                  <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="35" y="30" width="60" height="60" rx="8" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="2" strokeDasharray="4 4"/>
                    <path d="M50 45C50 45 55 50 60 45C65 40 70 45 70 45" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M45 60C45 60 50 55 55 60C60 65 65 60 65 60" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M55 75C55 75 60 70 65 75C70 80 75 75 75 75" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M75 55L75 60M85 30L90 35M30 75L25 70" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M92 40L95 48L103 51L95 54L92 62L89 54L81 51L89 48Z" fill="#C7D2FE" />
                    <path d="M40 20L42 25L47 27L42 29L40 34L38 29L33 27L38 25Z" fill="#E0E7FF" />
                  </svg>
                  <div className="st-pattern-empty-title">Seamless pattern will appear here</div>
                  <div className="st-pattern-empty-desc">Our AI will offset your image and seamlessly redraw the connections.</div>
                  <button className="st-pattern-btn-outline" disabled={true}>
                    <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={16} />
                    Make Seamless Base Tile
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }
    if (tool === 'library') {
      return (
        <div className="st-empty-canvas">
          <span className="st-empty-icon" style={{ fontSize: '2rem' }}>🚧</span>
          <h2 style={{ margin: '1rem 0 0.5rem', fontWeight: 600 }}>Brand Library is Under Construction</h2>
          <p style={{ maxWidth: '400px', margin: '0 auto', color: '#64748b' }}>We're building a dedicated space for you to manage your logos, color palettes, and brand assets.</p>
        </div>
      );
    }
    if (tool === 'vectorize' || tool === 'upscale') {
      const resultUrl = tool === 'vectorize' ? vecUrl : upscaleUrl;
      const loading = tool === 'vectorize' ? isVec : isUpscaling;
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
      <div className="st-inspire-main">
        {/* Upload Box */}
        <div 
          className="st-inspire-upload-box"
          onClick={() => fileRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}
          onDragOver={(e) => e.preventDefault()}
        >
          <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={24} />
          <h3>Upload reference image (optional)</h3>
          <p>{preview ? (uploaded?.originalName || 'Image Uploaded') : 'PNG, JPG up to 10MB'}</p>
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handleUpload(e.target.files[0])} />
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
          <button className="st-nav-item" onClick={() => setShowSettingsModal(true)}><I d="M12.2 2h-.4a2 2 0 00-2 2v.2a2 2 0 01-1 1.7l-.4.2a2 2 0 01-2 0l-.2-.1a2 2 0 00-2.7.7l-.2.4a2 2 0 00.7 2.7l.2.1a2 2 0 011 1.7v.5a2 2 0 01-1 1.8l-.2.1a2 2 0 00-.7 2.7l.2.4a2 2 0 002.7.7l.2-.1a2 2 0 012 0l.4.2a2 2 0 011 1.7v.2a2 2 0 002 2h.4a2 2 0 002-2v-.2a2 2 0 011-1.7l.4-.2a2 2 0 012 0l.2.1a2 2 0 002.7-.7l.2-.4a2 2 0 00-.7-2.7l-.2-.1a2 2 0 01-1-1.8v-.5a2 2 0 011-1.7l.2-.1a2 2 0 00.7-2.7l-.2-.4a2 2 0 00-2.7-.7l-.2.1a2 2 0 01-2 0l-.4-.2a2 2 0 01-1-1.7V4a2 2 0 00-2-2z" /><span>Settings</span></button>
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
          <main className={`st-center ${tool === 'repeat' ? 'no-scroll' : ''}`}>
            <div className="st-page-head">
              <div>
                <h1 className="st-title">{toolLabel} {tool === 'library' && <span className="st-pro-badge">Pro</span>}</h1>
                <p>{tool === 'dashboard' ? 'Build, customize, and run AI pipelines to transform your artwork into production-ready patterns.' : tool === 'pattern' ? 'Create, refine, and perfect repeat patterns with AI precision.' : tool === 'exports' ? 'View and download your recently exported assets.' : 'Upload artwork and generate print-ready assets.'}</p>
              </div>
              {/* Save/Export buttons hidden — exports auto-save to history */}
              {/* <div className="st-actions"><button>Save</button><button className="primary">Export</button></div> */}
            </div>
            {isLoadingState && <div className="st-error">Loading SQLite-backed studio state...</div>}
            {(tool !== 'dashboard' && tool !== 'exports' && tool !== 'pattern' && tool !== 'inspire' && tool !== 'seamless') && (
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
              </div>
            )}
            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handleUpload(e.target.files[0])} />
            {renderCanvas()}
            {error && <div className="st-error">{error}</div>}

          </main>
          {tool !== 'library' && tool !== 'exports' && (
            <aside className="st-right-panel">
              {tool === 'dashboard' ? (
                <div className="st-pl-right">
                  <div className="st-pl-right-header">
                    <strong>Live Preview</strong>
                    {pipelineCurrentStep >= 0 && <span className="st-pl-step-indicator">Step {pipelineCurrentStep + 1} of {pipelineSteps.length}</span>}
                  </div>
                  <div className="st-pl-preview-area">
                    {pipelinePreview ? (
                      <img src={pipelinePreview} alt="Pipeline Preview" className="st-pl-preview-img" />
                    ) : (
                      <div className="st-pl-preview-empty">
                        <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={32} />
                        <span>Run your pipeline to see a live preview</span>
                      </div>
                    )}
                  </div>
                  <div className="st-pl-runs-section">
                    <strong>Recent Runs</strong>
                    {pipelineRuns.length > 0 ? (
                      <div className="st-pl-runs-list">
                        {pipelineRuns.slice(0, 5).map(run => (
                          <div key={run.id} className="st-pl-run-row">
                            <div className="st-pl-run-info">
                              <strong>{run.name}</strong>
                              <span>{new Date(run.createdAt).toLocaleDateString()}</span>
                            </div>
                            <span className={`st-pl-run-status ${run.status}`}>{run.status}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="st-pl-runs-empty">No pipeline runs yet.</p>
                    )}
                  </div>
                </div>
              ) : renderControls()}
            </aside>
          )}
        </div>
      </div>

      {showSettingsModal && (
        <div className="st-modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="st-modal" onClick={e => e.stopPropagation()}>
            <div className="st-modal-header">
              <h2>Projects Management</h2>
              <button className="st-modal-close" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>
            <div className="st-modal-body">
              <div className="st-settings-projects">
                <div style={{display:'flex', gap:'0.5rem', marginBottom:'1rem'}}>
                  <input type="text" id="newProjectName" placeholder="New Project Name..." className="st-input" style={{flex:1}} />
                  <button className="st-btn primary" onClick={async () => {
                    const inp = document.getElementById('newProjectName');
                    if (!inp.value) return;
                    const r = await fetch(`${API}/api/projects`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: inp.value}) });
                    if (r.ok) { inp.value = ''; loadStudioState(activeProject.id); }
                  }}>Create Project</button>
                </div>
                {state.projects.map(p => (
                  <div key={p.id} className="st-settings-project-row">
                    <img 
                      src={p.thumbnailUrl && p.thumbnailUrl.startsWith('/') ? `${API}${p.thumbnailUrl}` : (p.thumbnailUrl || '/demo_geometric.png')} 
                      alt="Thumb" 
                      style={{width: 32, height: 32, borderRadius: 6, objectFit: 'cover', border: '1px solid #e2e7f0', cursor: 'pointer'}} 
                      title="Click to update thumbnail URL"
                      onClick={async () => {
                        const url = prompt('Enter new image URL or path for this project thumbnail:', p.thumbnailUrl);
                        if (url && url !== p.thumbnailUrl) {
                          await fetch(`${API}/api/projects/${p.id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({thumbnail_url: url}) });
                          loadStudioState(activeProject.id);
                        }
                      }}
                    />
                    <input 
                      type="text" 
                      defaultValue={p.name} 
                      className="st-input"
                      onBlur={async (e) => {
                        if (e.target.value !== p.name && e.target.value.trim() !== '') {
                          await fetch(`${API}/api/projects/${p.id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: e.target.value}) });
                          loadStudioState(activeProject.id);
                        }
                      }}
                    />
                    <button className="st-btn danger" disabled={state.projects.length <= 1} onClick={async () => {
                      if (!window.confirm('Are you sure? This will delete all history, variations, and settings for this project.')) return;
                      await fetch(`${API}/api/projects/${p.id}`, { method: 'DELETE' });
                      loadStudioState(state.projects.find(x => x.id !== p.id).id);
                    }}>Delete</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
