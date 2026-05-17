const fs = require('fs');
const code = `import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
const API = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');
const I = ({ d, s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>);
const NAV = [
  { section: '', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }] },
  { section: 'AI DESIGN TOOLS', items: [
    { id: 'pattern', label: 'Pattern Studio', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z' },
    { id: 'repeat', label: 'Repeat Set', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
    { id: 'inspire', label: 'Inspirations', icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2c3.1 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z' },
    { id: 'vectorize', label: 'Vectorize', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z' },
  ]},
  { section: 'ASSETS & LIBRARY', items: [
    { id: 'library', label: 'Brand Library', icon: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z' },
    { id: 'exports', label: 'Exports', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3' },
  ]},
];
const emptyState = {
  user: { name: '', initials: '', plan: '', creditsUsed: 0, creditsLimit: 1, resetDays: 0 },
  activeProject: { id: 1, name: 'Loading...', heroImageUrl: '/demo_floral.png' },
  projects: [], variations: [],
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
  const loadStudioState = useCallback(async (projectId = activeProjectId) => {
    setError('');
    try {
      const r = await fetch(\\\`\\\${API}/api/studio-state?projectId=\\\${projectId}\\\`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Failed');
      hasLoadedControls.current = false;
      setState(d.state); setActiveProjectId(d.state.activeProject.id);
      window.setTimeout(() => { hasLoadedControls.current = true; }, 0);
    } catch { setError('Backend not connected. Start Flask on port 3001.'); }
    finally { setIsLoadingState(false); }
  }, [activeProjectId]);
  useEffect(() => { loadStudioState(1); }, [loadStudioState]);
  const updateControls = useCallback((patch) => {
    setState((c) => ({ ...c, controls: { ...c.controls, ...patch } }));
  }, []);
  useEffect(() => {
    if (!hasLoadedControls.current) return;
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch(\\\`\\\${API}/api/projects/\\\${activeProject.id}/controls\\\`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(controls) });
        const d = await r.json();
        if (d.success) setState(d.state);
      } catch { setError('Control changes are local only.'); }
    }, 350);
    return () => window.clearTimeout(id);
  }, [controls, activeProject.id]);
`;
fs.writeFileSync('src/pages/Studio_p1.jsx', code);
console.log('Part 1 written');
`;
fs.writeFileSync('src/pages/Studio_p1.jsx', code);
console.log('Part 1 written');
