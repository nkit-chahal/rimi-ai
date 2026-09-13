import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../components/studio/shared/helpers';
import StitchStylesTool from '../components/studio/tools/StitchStylesTool';
import TechPackTool from '../components/studio/tools/TechPackTool';
import { createDocument, saveDraft } from '../components/studio/shared/placementDocument';
import { useResultUrls } from '../stores/resultUrls';

vi.mock('../components/studio/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
}

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage(), configurable: true, writable: true });
});

const baseProps = {
  uploaded: null,
  preview: null,
  uploadStatus: undefined,
  activeProject: { id: 1, name: 'Saree' },
  user: { id: 1, creditsLimit: 500, creditsUsed: 0 },
  currentToken: 'token',
  creditPricing: { stitchRenderMotif: 35, stitchRenderDesign: 67, embroideryTechPack: 3 },
  setError: vi.fn(),
  setNotice: vi.fn(),
  setTool: vi.fn(),
  updateCreditsFromResponse: vi.fn(),
  handlePreUpload: vi.fn(),
  onUploadInvalid: vi.fn(),
  onUploadPaste: vi.fn(),
};

const MOTIF = { id: 1, name: 'Paisley', technique: 'zari', tags: [], filename: 'p.png', url: '/uploads/p.png', width: 400, height: 200, fileAccessToken: 't' };
const STYLES = {
  success: true,
  styles: [
    { id: 'satin', label: 'Satin stitch', blurb: 'Borders.', density: 900 },
    { id: 'zardozi', label: 'Zardozi', blurb: 'Bridal borders.', density: 700 },
  ],
  finishes: ['cotton', 'rayon', 'metallic'],
  densities: ['light', 'medium', 'dense'],
  directions: ['follow', 'horizontal', 'diagonal'],
};

describe('StitchStylesTool', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useResultUrls.getState().clearPendingMotif();
    useResultUrls.getState().setLastPlacementResult(null);
    apiFetch.mockImplementation((url, options = {}) => {
      if (url === '/api/stitch/styles') return Promise.resolve(STYLES);
      if (url === '/api/motifs') return Promise.resolve({ success: true, motifs: [MOTIF] });
      if (url === '/api/stitch/render') {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          success: true, resultUrl: '/results/stitch_1.png', filename: 'stitch_1.png', fileAccessToken: 's', width: 400, height: 200,
          mode: body.mode, style: body.style, creditsUsed: body.mode === 'motif' ? 35 : 67,
          motif: body.mode === 'motif' ? { id: 21, name: 'Zardozi render', technique: 'embroidery', filename: 'stitch_1.png', url: '/results/stitch_1.png', width: 400, height: 200 } : null,
        });
      }
      return Promise.resolve({ success: false, error: `unexpected ${url}` });
    });
  });

  it('renders a library motif in a chosen style through the background task and can place the result', async () => {
    const addBgTask = vi.fn();
    const setTool = vi.fn();
    render(<StitchStylesTool {...baseProps} addBgTask={addBgTask} setTool={setTool} />);

    const renderButton = screen.getByRole('button', { name: /Render embroidery/ });
    expect(renderButton).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /Paisley/ }));
    expect(screen.getByRole('tab', { name: /Single motif/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(await screen.findByRole('radio', { name: /Zardozi/ }));
    fireEvent.change(screen.getByLabelText('Thread finish'), { target: { value: 'metallic' } });
    expect(renderButton).toBeEnabled();
    expect(renderButton).toHaveTextContent('35 credits');

    fireEvent.click(renderButton);
    expect(addBgTask).toHaveBeenCalledTimes(1);
    const [type, , filename, trigger] = addBgTask.mock.calls[0];
    expect(type).toBe('emb-stitches');
    expect(filename).toBe('p.png');
    await trigger();

    const call = apiFetch.mock.calls.find(([url]) => url === '/api/stitch/render');
    expect(JSON.parse(call[1].body)).toMatchObject({ sourceFilename: 'p.png', mode: 'motif', style: 'zardozi', finish: 'metallic', saveToLibrary: true });

    await waitFor(() => expect(screen.getByText(/Zardozi · motif/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    expect(setTool).toHaveBeenCalledWith('emb-placement');
    expect(useResultUrls.getState().pendingMotif?.id).toBe(21);
  });

  it('uses the whole-design mode for the latest placement and offers mockups afterwards', async () => {
    useResultUrls.getState().setLastPlacementResult({ url: '/results/placement_1.png', filename: 'placement_1.png', fileAccessToken: 'p', width: 2000, height: 1000 });
    const setTool = vi.fn();
    render(<StitchStylesTool {...baseProps} setTool={setTool} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use latest placement' }));
    expect(screen.getByRole('tab', { name: /Whole design/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Render embroidery \(67 credits\)/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Mockups/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Mockups/ }));
    expect(setTool).toHaveBeenCalledWith('emb-mockups');
    expect(useResultUrls.getState().lastPlacementResult.filename).toBe('stitch_1.png');
  });
});

describe('TechPackTool', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    const doc = createDocument({ width: 2000, height: 1000 });
    doc.layers = [{ id: 'L1', name: 'Paisley', filename: 'p.png', url: '/uploads/p.png', width: 400, height: 200, x: 1000, y: 500, scaleX: 1, scaleY: 1, angle: 0, visible: true }];
    saveDraft(1, doc);
    useResultUrls.getState().setLastPlacementResult({ url: '/results/placement_1.png', filename: 'placement_1.png', fileAccessToken: 'p', width: 2000, height: 1000 });
    apiFetch.mockImplementation((url, options = {}) => {
      if (url.startsWith('/api/thread-palettes')) {
        return Promise.resolve({ success: true, palettes: [{ id: 7, name: 'Border reds', cardId: 'starter-threads', entries: [{ code: 'T-015', name: 'Scarlet', hex: '#c8102e', deltaE: 0.4, sourceHex: '#c9102f' }] }] });
      }
      if (url === '/api/techpack/embroidery') {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          success: true, resultUrl: '/results/embtechpack_1.pdf', filename: 'embtechpack_1.pdf', fileAccessToken: 'k', creditsUsed: 3,
          summary: {
            pxPerCm: 2000 / body.physicalWidthCm, physicalWidthCm: body.physicalWidthCm, physicalHeightCm: 1000 / (2000 / body.physicalWidthCm), totalStitches: 4200,
            layers: body.layers.map((layer) => ({ ...layer, x_cm: 15, y_cm: 7.5, w_cm: 6, h_cm: 3, coverage: 0.5, stitch_style: layer.stitchStyle, stitches: 4200 })),
          },
        });
      }
      return Promise.resolve({ success: false, error: `unexpected ${url}` });
    });
  });

  it('builds the request from the placement draft, thread palette and size, then shows estimates', async () => {
    render(<TechPackTool {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use latest placement' }));
    expect(screen.getByText(/2000×1000 px → 30.0 × 15.0 cm/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Stitch style for Paisley'), { target: { value: 'zardozi' } });
    fireEvent.change(await screen.findByLabelText('Thread palette'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Design width in centimetres'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate tech pack/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Download PDF/ })).toBeInTheDocument());
    const call = apiFetch.mock.calls.find(([url]) => url === '/api/techpack/embroidery');
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({ projectId: 1, designFilename: 'placement_1.png', docWidthPx: 2000, docHeightPx: 1000, physicalWidthCm: 40, product: 'Saree', zone: 'pallu' });
    expect(body.layers).toHaveLength(1);
    expect(body.layers[0]).toMatchObject({ name: 'Paisley', filename: 'p.png', x: 1000, y: 500, stitchStyle: 'zardozi', density: 'medium' });
    expect(body.threads).toHaveLength(1);
    expect(screen.getByText('4,200')).toBeInTheDocument();
    expect(baseProps.setNotice).toHaveBeenCalledWith(expect.stringMatching(/4,200 estimated stitches/));
  });
});
