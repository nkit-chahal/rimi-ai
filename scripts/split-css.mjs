// One-shot CSS splitter: reads src/index.css and writes split files.
// Run with: node scripts/split-css.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = readFileSync(join(root, 'src', 'index.css'), 'utf8');
const lines = src.split('\n');

// Map: section header (substring) -> target file
const SECTION_MAP = [
  // base.css — loaded on every page
  { match: 'GLOBAL RESETS & SCROLLBAR', file: 'base' },
  { match: 'ANIMATIONS', file: 'base' },
  { match: 'LUXURY RANGE CONTROL', file: 'base' },
  { match: 'Error boundary', file: 'base' },
  { match: 'Coming soon tool lock', file: 'base' },

  // landing.css — login/landing page only
  { match: 'LANDING PAGE', file: 'landing' },
  { match: 'LOGIN PORTAL DESIGN', file: 'landing' },
  { match: 'PREMIUM AUTH PORTAL', file: 'landing' },

  // studio-shell.css — studio layout, nav, shared studio UI
  { match: 'STUDIO DASHBOARD', file: 'studio-shell' },
  { match: 'REFERENCE-STYLE STUDIO OVERRIDES', file: 'studio-shell' },
  { match: 'CREATIVE SIDEBAR', file: 'studio-shell' },
  { match: 'Account dropdown', file: 'studio-shell' },
  { match: 'Workspace manager', file: 'studio-shell' },
  { match: 'PIPELINE STUDIO', file: 'studio-shell' },
  { match: 'Studio boot splash', file: 'studio-shell' },
  { match: 'Global studio banners', file: 'studio-shell' },
  { match: 'Command palette', file: 'studio-shell' },
  { match: 'Project dropdown items', file: 'studio-shell' },
  { match: 'Mobile navigation drawer', file: 'studio-shell' },

  // admin.css — admin workspace only
  { match: 'ADMIN WORKSPACE STYLING', file: 'admin' },

  // tools/pattern.css — pattern extraction + multi-model extract
  { match: 'PATTERN EXTRACTION OVERRIDES', file: 'tools/pattern' },
  { match: 'CREATIVE UI/UX UPGRADE', file: 'tools/pattern' },
  { match: 'MULTI-MODEL EXTRACT GRID', file: 'tools/pattern' },
  { match: 'EXTRACT GALLERY LIGHTBOX', file: 'tools/pattern' },
  { match: 'EXTRACT CHAT PANEL', file: 'tools/pattern' },
  { match: 'PATTERN EXTRACTION STUDIO LAYOUT REFINEMENT', file: 'tools/pattern' },

  // tools/imagelayers.css
  { match: 'IMAGE LAYERS', file: 'tools/imagelayers' },
  { match: 'INTERACTIVE LAYER EDITOR', file: 'tools/imagelayers' },

  // tools/inspire.css
  { match: 'INSPIRATIONS OVERRIDES', file: 'tools/inspire' },
  { match: 'INSPIRATIONS STUDIO REFRESH', file: 'tools/inspire' },
  { match: 'INSPIRATIONS REFERENCE THEME', file: 'tools/inspire' },

  // tools/repeat.css
  { match: 'REPEAT SET FREE BOARD OVERRIDES', file: 'tools/repeat' },

  // tools/exports.css
  { match: 'EXPORTS PAGE', file: 'tools/exports' },
  { match: 'PREMIUM EXPORTS PAGE OVERRIDES', file: 'tools/exports' },

  // tools/mappings.css
  { match: 'MAPPINGS PAGE', file: 'tools/mappings' },
  { match: 'STEP INDICATOR', file: 'tools/mappings' },
  { match: 'UPLOAD ZONE', file: 'tools/mappings' },
  { match: 'PRINT PREVIEW', file: 'tools/mappings' },
  { match: 'CATEGORIES', file: 'tools/mappings' },
  { match: 'PRODUCTS', file: 'tools/mappings' },

  // shared creative UI (creativity pills, multi-model panel, top-up) -> studio-shell
  { match: 'CREATIVITY PILLS', file: 'studio-shell' },
  { match: 'MULTI-MODEL PANEL', file: 'studio-shell' },
  { match: 'Custom Top-up Section', file: 'studio-shell' },
];

function findTarget(line) {
  for (const rule of SECTION_MAP) {
    if (line.includes(rule.match)) return rule.file;
  }
  return null;
}

// Walk lines, group sections by target file
const buckets = {};
let currentTarget = null;
let currentHeader = '';

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Detect section headers: lines starting with /* and containing ===== or ====
  const isHeader = /^\s*\/\*\s*[=]{3,}/.test(line) || /^\s*\/\*\s*=====/.test(line);
  if (isHeader) {
    // Read the full header (may span multiple lines until closing */)
    let header = line;
    let j = i;
    while (!header.includes('*/') && j + 1 < lines.length) {
      header += '\n' + lines[++j];
    }
    const target = findTarget(header);
    if (target) {
      currentTarget = target;
      currentHeader = header;
      // Start a new bucket section
      if (!buckets[target]) buckets[target] = [];
      buckets[target].push({ header, startLine: i, lines: [] });
      // Skip past the header lines
      i = j;
      continue;
    }
  }
  // If we're inside a section, append the line
  if (currentTarget && buckets[currentTarget]?.length) {
    buckets[currentTarget][buckets[currentTarget].length - 1].lines.push(line);
  } else {
    // Lines before any section header go to base.css
    if (!buckets.base) buckets.base = [];
    if (!buckets.base.length) buckets.base.push({ header: '/* pre-section */', startLine: 0, lines: [] });
    buckets.base[0].lines.push(line);
  }
}

// Write files
const stylesDir = join(root, 'src', 'styles');
const toolsDir = join(stylesDir, 'tools');
mkdirSync(toolsDir, { recursive: true });

let totalWritten = 0;
for (const [name, sections] of Object.entries(buckets)) {
  const filePath = join(stylesDir, name + '.css');
  const content = sections.map(s => s.header + '\n' + s.lines.join('\n')).join('\n\n');
  writeFileSync(filePath, content + '\n', 'utf8');
  const lineCount = content.split('\n').length;
  totalWritten += lineCount;
  console.log(`  ${name}.css: ${lineCount} lines`);
}
console.log(`Total lines written: ${totalWritten} (source: ${lines.length})`);
