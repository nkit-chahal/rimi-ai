import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../components/studio/shared/helpers';
import ThreadShadesTool from '../components/studio/tools/ThreadShadesTool';
import MotifLibraryTool from '../components/studio/tools/MotifLibraryTool';
import { useResultUrls } from '../stores/resultUrls';

vi.mock('../components/studio/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

const baseProps = {
  uploaded: null,
  preview: null,
  uploadStatus: undefined,
  isUploading: false,
  activeProject: { id: 1, name: 'Saree' },
  user: { id: 1, creditsLimit: 100, creditsUsed: 10 },
  currentToken: 'token',
  creditPricing: { removeBg: 2 },
  tool: 'emb-motifs',
  setError: vi.fn(),
  setNotice: vi.fn(),
  setTool: vi.fn(),
  setUploads: vi.fn(),
  updateCreditsFromResponse: vi.fn(),
  handlePreUpload: vi.fn(),
  onUploadInvalid: vi.fn(),
  onUploadPaste: vi.fn(),
};

const STARTER = { id: 'starter-threads', name: 'Starter thread card (demo)', kind: 'thread', count: 48, builtIn: true, note: 'Demo card.' };
const PANTONE = { id: 'pantone-tcx', name: 'Pantone TCX', kind: 'pantone', count: 416, builtIn: true, note: '' };

function routeThreads(url, options = {}) {
  const body = options.body ? JSON.parse(options.body) : {};
  if (url === '/api/shade-cards') return Promise.resolve({ success: true, cards: [PANTONE, STARTER] });
  if (url.startsWith('/api/thread-palettes') && (!options.method || options.method === 'GET')) return Promise.resolve({ success: true, palettes: [] });
  if (url === '/api/shade-cards/match') {
    return Promise.resolve({
      success: true,
      cardId: body.cardId,
      cardName: 'Starter thread card (demo)',
      results: body.colors.map((hex) => ({
        hex,
        matches: [
          { code: 'T-015', name: 'Scarlet', hex: '#c8102e', deltaE: 0.3 },
          { code: 'T-014', name: 'Vermilion', hex: '#d94a38', deltaE: 6.2 },
          { code: 'T-016', name: 'Crimson', hex: '#a4123f', deltaE: 9.8 },
        ],
      })),
    });
  }
  if (url === '/api/thread-palettes' && options.method === 'POST') {
    return Promise.resolve({ success: true, palette: { id: 7, projectId: 1, name: body.name, cardId: body.cardId, entries: body.entries, createdAt: 'now' } });
  }
  return Promise.resolve({ success: false, error: `unexpected ${url}` });
}

describe('ThreadShadesTool', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(routeThreads);
  });

  it('loads shade cards, defaults to the thread card, matches a manual colour and saves a palette', async () => {
    render(<ThreadShadesTool {...baseProps} tool="emb-threads" />);

    const select = await screen.findByLabelText('Shade card');
    await waitFor(() => expect(select.value).toBe('starter-threads'));
    expect(screen.getByText('Demo card.')).toBeInTheDocument();

    const hexInput = screen.getByLabelText('Add a colour');
    fireEvent.change(hexInput, { target: { value: '#C8102E' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

    expect(await screen.findByText('T-015', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Exact/)).toBeInTheDocument();
    const matchCall = apiFetch.mock.calls.find(([url]) => url === '/api/shade-cards/match');
    expect(JSON.parse(matchCall[1].body)).toMatchObject({ cardId: 'starter-threads', colors: ['#c8102e'], topN: 3 });

    // Pick the second alternative, then save.
    fireEvent.click(screen.getByRole('button', { name: /T-014/ }));
    fireEvent.change(screen.getByLabelText('Palette name'), { target: { value: 'Border reds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));

    await waitFor(() => {
      const saveCall = apiFetch.mock.calls.find(([url, opts]) => url === '/api/thread-palettes' && opts?.method === 'POST');
      expect(saveCall).toBeTruthy();
      expect(JSON.parse(saveCall[1].body)).toMatchObject({
        projectId: 1,
        name: 'Border reds',
        cardId: 'starter-threads',
        entries: [{ sourceHex: '#c8102e', code: 'T-014', hex: '#d94a38' }],
      });
    });
    expect(await screen.findByText('Border reds')).toBeInTheDocument();
    expect(baseProps.setNotice).toHaveBeenCalled();
  });

  it('rejects an invalid manual hex without calling the API', async () => {
    render(<ThreadShadesTool {...baseProps} tool="emb-threads" />);
    await screen.findByLabelText('Shade card');
    fireEvent.change(screen.getByLabelText('Add a colour'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(baseProps.setError).toHaveBeenCalledWith(expect.stringMatching(/hex colour/));
    expect(apiFetch.mock.calls.some(([url]) => url === '/api/shade-cards/match')).toBe(false);
  });
});

const MOTIF = {
  id: 1, projectId: 1, name: 'Paisley border', technique: 'zari', tags: ['border', 'paisley'],
  filename: 'a.png', url: '/uploads/a.png', width: 48, height: 32, fileAccessToken: 'tok', createdAt: 'now',
};

describe('MotifLibraryTool', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useResultUrls.getState().clearPendingMotif();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('lists motifs, filters by technique, hands a motif to Placement Studio and removes one', async () => {
    apiFetch.mockImplementation((url, options = {}) => {
      if (url === '/api/motifs' && !options.method) return Promise.resolve({ success: true, motifs: [MOTIF], techniques: ['embroidery', 'zari'] });
      if (url === '/api/motifs/1' && options.method === 'DELETE') return Promise.resolve({ success: true });
      return Promise.resolve({ success: false, error: `unexpected ${url}` });
    });
    const setTool = vi.fn();
    render(<MotifLibraryTool {...baseProps} setTool={setTool} />);

    expect(await screen.findByText('Paisley border')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /zari · 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /^lace$/i }));
    expect(screen.getByText('Nothing matches this filter')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /All/ }));

    fireEvent.click(screen.getByRole('button', { name: /Place/ }));
    expect(setTool).toHaveBeenCalledWith('emb-placement');
    expect(useResultUrls.getState().pendingMotif?.id).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Paisley border' }));
    await waitFor(() => expect(screen.queryByText('Paisley border')).toBeNull());
    expect(screen.getByText('Your library is empty')).toBeInTheDocument();
  });

  it('requires an uploaded image before adding and explains why', async () => {
    apiFetch.mockImplementation(() => Promise.resolve({ success: true, motifs: [], techniques: [] }));
    render(<MotifLibraryTool {...baseProps} />);
    await screen.findByText('Your library is empty');
    const addButton = screen.getByRole('button', { name: 'Add to library' });
    expect(addButton).toBeDisabled();
  });
});
