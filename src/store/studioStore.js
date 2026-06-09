import { create } from 'zustand';

export const useStudioStore = create((set) => ({
  tool: 'pattern',
  error: '',
  notice: '',
  activeProjectId: 1,
  setTool: (tool) => set({ tool }),
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
}));
