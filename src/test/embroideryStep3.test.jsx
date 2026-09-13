import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../components/studio/shared/helpers';
import AppliqueTool from '../components/studio/tools/AppliqueTool';
import EmbroideryMockupsTool from '../components/studio/tools/EmbroideryMockupsTool';
import { useResultUrls } from '../stores/resultUrls';

vi.mock('../components/studio/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

const baseProps = {
  uploaded: null,
  preview: null,
  uploadStatus: undefined,
  activeProject: { id: 1, name: 'Saree', heroImageUrl: '/results/hero.png' },
  user: { id: 1, creditsLimit: 500, creditsUsed: 0 },
  currentToken: 'token',
  creditPricing: { appliqueCreate: 2, embellishGenerate: 1, embroideryMockup: 67 },
  setError: vi.fn(),
  setNotice: vi.fn(),
  setTool: vi.fn(),
  updateCreditsFromResponse: vi.fn(),
  handlePreUpload: vi.fn(),
  onUploadInvalid: vi.fn(),
  onUploadPaste: vi.fn(),
};

const MOTIF = { id: 1, name: 'Paisley', technique: 'zari', tags: [], filename: 'p.png', url: '/uploads/p.png', width: 100, height: 80, fileAccessToken: 't' };

describe('AppliqueTool', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useResultUrls.getState().clearPendingMotif();
  });

  it('cuts a library shape into a patch, saves it to the library and can place it', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/motifs') return Promise.resolve({ success: true, motifs: [MOTIF] });
      if (url === '/api/applique/create') {
        return Promise.resolve({
          success: true, resultUrl: '/results/applique_1.png', filename: 'applique_1.png', width: 120, height: 100, creditsUsed: 2,
          motif: { id: 9, name: 'Paisley appliqué', technique: 'applique', tags: ['applique'], filename: 'applique_1.png', url: '/results/applique_1.png', width: 120, height: 100, fileAccessToken: 'x' },
        });
      }
      return Promise.resolve({ success: false, error: `unexpected ${url}` });
    });
    const setTool = vi.fn();
    render(<AppliqueTool {...baseProps} setTool={setTool} />);

    const createButton = screen.getByRole('button', { name: /Create patch/ });
    expect(createButton).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /Paisley/ }));
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);

    // The patch shows in the results and, because it was saved, in the library picker too.
    expect((await screen.findAllByText('Paisley appliqué')).length).toBeGreaterThanOrEqual(1);
    const call = apiFetch.mock.calls.find(([url]) => url === '/api/applique/create');
    expect(JSON.parse(call[1].body)).toMatchObject({
      projectId: 1,
      shapeFilename: 'p.png',
      fill: { kind: 'solid' },
      edge: { style: 'satin', width: 6 },
      shadow: true,
      saveToLibrary: true,
    });

    fireEvent.click(screen.getByRole('button', { name: /Place/ }));
    expect(setTool).toHaveBeenCalledWith('emb-placement');
    expect(useResultUrls.getState().pendingMotif?.id).toBe(9);
  });

  it('generates an embellishment sheet from the second tab', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/motifs') return Promise.resolve({ success: true, motifs: [] });
      if (url === '/api/embellish/generate') {
        return Promise.resolve({ success: true, resultUrl: '/results/embellish_1.png', filename: 'embellish_1.png', width: 1200, height: 200, creditsUsed: 1, motif: { id: 3, name: 'Sequins border row', technique: 'embellishment', filename: 'embellish_1.png', url: '/results/embellish_1.png' } });
      }
      return Promise.resolve({ success: false });
    });
    render(<AppliqueTool {...baseProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Embellishments' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Mirror work' }));
    fireEvent.click(screen.getByRole('button', { name: /Generate/ }));

    expect(await screen.findByText('Sequins border row')).toBeInTheDocument();
    const call = apiFetch.mock.calls.find(([url]) => url === '/api/embellish/generate');
    expect(JSON.parse(call[1].body)).toMatchObject({ kind: 'mirror', layout: 'row', width: 1200, height: 200, saveToLibrary: true });
  });
});

describe('EmbroideryMockupsTool', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url, options = {}) => {
      if (url === '/api/motifs') return Promise.resolve({ success: true, motifs: [] });
      if (url === '/api/embroidery/mockup') {
        const body = JSON.parse(options.body);
        return Promise.resolve({ success: true, mockupUrl: '/results/embmockup_1.png', filename: 'embmockup_1.png', fileAccessToken: 'm', productType: body.productType, zone: body.zone, technique: body.technique, fabric: body.fabric, creditsUsed: 67 });
      }
      return Promise.resolve({ success: false });
    });
    useResultUrls.getState().setLastPlacementResult({ url: '/results/placement_1.png', filename: 'placement_1.png', fileAccessToken: 'p', width: 2000, height: 2000 });
  });

  it('warns about bad pairings and sends a zone-specific request through the background task', async () => {
    const addBgTask = vi.fn();
    render(<EmbroideryMockupsTool {...baseProps} addBgTask={addBgTask} />);

    const generateButton = screen.getByRole('button', { name: /Generate mockup/ });
    expect(generateButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use latest placement' }));
    expect(generateButton).toBeEnabled();

    // Saree defaults: pallu zone, zari on silk is a classic pairing.
    expect(screen.getByRole('tab', { name: 'pallu' })).toBeInTheDocument();
    expect(screen.getByText('Good match')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'T-Shirt' }));
    expect(screen.getByRole('tab', { name: 'chest' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Fabric'), { target: { value: 'jersey' } });
    expect(screen.getByText('Avoid')).toBeInTheDocument();

    fireEvent.click(generateButton);
    expect(addBgTask).toHaveBeenCalledTimes(1);
    const [type, label, filename, trigger] = addBgTask.mock.calls[0];
    expect(type).toBe('emb-mockups');
    expect(label).toMatch(/T-Shirt/);
    expect(filename).toBe('placement_1.png');

    await trigger();
    const call = apiFetch.mock.calls.find(([url]) => url === '/api/embroidery/mockup');
    expect(JSON.parse(call[1].body)).toMatchObject({ sourceFilename: 'placement_1.png', productType: 'tshirt', zone: 'chest', technique: 'zari', fabric: 'jersey' });
    await waitFor(() => expect(screen.getByText(/T-Shirt · chest/)).toBeInTheDocument());
  });
});
