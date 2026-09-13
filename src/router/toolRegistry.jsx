import { lazy } from 'react';

export const TOOL_COMPONENTS = {
  dashboard: lazy(() => import('../components/studio/tools/DashboardTool')),
  exports: lazy(() => import('../components/studio/tools/ExportsTool')),
  pattern: lazy(() => import('../components/studio/tools/PatternTool')),
  seamless: lazy(() => import('../components/studio/tools/SeamlessTool')),
  repeat: lazy(() => import('../components/studio/tools/RepeatTool')),
  mappings: lazy(() => import('../components/studio/tools/MappingsTool')),
  inspire: lazy(() => import('../components/studio/tools/InspireTool')),
  vectorize: lazy(() => import('../components/studio/tools/VectorizeTool')),
  upscale: lazy(() => import('../components/studio/tools/VectorizeTool')),
  removebg: lazy(() => import('../components/studio/tools/RemoveBgTool')),
  imagelayers: lazy(() => import('../components/studio/tools/ImageLayersTool')),
  colorways: lazy(() => import('../components/studio/tools/ColorwaysTool')),
  'colorway-manager': lazy(() => import('../components/studio/tools/ColorwayManagerTool')),
  vectorpro: lazy(() => import('../components/studio/tools/VectorProTool')),
  mockup3d: lazy(() => import('../components/studio/tools/Mockup3DTool')),
  'emb-threads': lazy(() => import('../components/studio/tools/ThreadShadesTool')),
  'emb-motifs': lazy(() => import('../components/studio/tools/MotifLibraryTool')),
  'emb-placement': lazy(() => import('../components/studio/tools/PlacementStudioTool')),
  'emb-applique': lazy(() => import('../components/studio/tools/AppliqueTool')),
  'emb-mockups': lazy(() => import('../components/studio/tools/EmbroideryMockupsTool')),
  'emb-stitches': lazy(() => import('../components/studio/tools/StitchStylesTool')),
  'emb-techpack': lazy(() => import('../components/studio/tools/TechPackTool')),
  'admin-dashboard': lazy(() => import('../components/studio/admin/AdminDashboard')),
  'admin-users': lazy(() => import('../components/studio/admin/AdminUsers')),
  'admin-projects': lazy(() => import('../components/studio/admin/AdminProjects')),
  'admin-logs': lazy(() => import('../components/studio/admin/AdminLogs')),
  'admin-credits': lazy(() => import('../components/studio/admin/AdminCredits')),
};

export function resolveToolComponent(toolId) {
  return TOOL_COMPONENTS[toolId] || null;
}
