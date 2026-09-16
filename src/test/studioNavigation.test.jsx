import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Studio from '../pages/Studio';

vi.mock('../router/toolRegistry', () => ({
  resolveToolComponent: () => function ToolStub() { return <div data-testid="tool-canvas" />; },
}));

vi.mock('../contexts/BgTaskContext', () => ({
  useBgTasks: () => ({
    bgTasks: [],
    addBgTask: vi.fn(),
    dismissTask: vi.fn(),
    clearFinished: vi.fn(),
    retryTask: vi.fn(),
    canRetryTask: vi.fn(() => false),
  }),
}));

vi.mock('../stores/resultUrls', () => ({
  useResultUrls: () => ({
    enh: '', seamless: '', vec: '', upscale: '', removeBg: '', cw: '', repeat: '', qwenLaunch: null,
    setRaw: vi.fn(), set: vi.fn(), clearQwenLaunch: vi.fn(), setQwenLaunch: vi.fn(),
  }),
}));

const currentUser = {
  id: 7,
  role: 'user',
  name: 'Preeti Sharma',
  initials: 'PS',
  plan: 'Business Pro',
  creditsUsed: 10,
  creditsLimit: 100,
};

describe('Studio contextual navigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/studio/pattern');
  });

  it('shows the complete original navigation throughout Print Studio, then removes the sidebar on Home', () => {
    render(<Studio currentUser={currentUser} currentToken="" onLogout={vi.fn()} />);

    const sidebar = document.querySelector('.st-sidebar');
    const studioNav = within(sidebar);
    const originalTools = [
      'Pipeline Studio', 'Pattern Extraction', 'Make Seamless', 'Repeat Set', 'Mappings',
      'Inspirations', 'Vectorize', 'Super Resolution', 'Remove Background', 'Qwen Studio',
      'Colorways', 'Colorway Manager', 'Vector Pro', '3D Mockup', 'Brand Library',
      'Measurement', 'Exports', 'Billing',
    ];

    originalTools.forEach((label) => {
      expect(studioNav.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    });

    fireEvent.click(studioNav.getByRole('button', { name: 'Exports' }));
    expect(studioNav.getByRole('button', { name: 'Inspirations' })).toBeInTheDocument();

    fireEvent.click(studioNav.getByRole('button', { name: 'Home' }));
    expect(document.querySelector('.st-sidebar')).toBeNull();
    expect(screen.getByRole('button', { name: 'RIMI AI Home' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
  });

  it('uses the complete Print navigation in the mobile drawer', () => {
    render(<Studio currentUser={currentUser} currentToken="" onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(mobileNav).getByRole('button', { name: 'Super Resolution' })).toBeInTheDocument();
    expect(within(mobileNav).getByRole('button', { name: /Brand Library/i })).toBeInTheDocument();
  });
});
