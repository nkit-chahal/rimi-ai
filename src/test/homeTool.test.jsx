import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HomeTool from '../components/studio/tools/HomeTool';
import NewProjectModal from '../components/studio/shared/NewProjectModal';

const user = { name: 'Preeti Sharma', plan: 'Creator', creditsUsed: 120, creditsLimit: 14520 };
const projects = [
  { id: 1, name: 'Spring Florals', thumbnailUrl: '', updatedAt: '2026-09-16T08:00:00', updatedLabel: '2h ago' },
  { id: 2, name: 'Yarn Dyed Checks', thumbnailUrl: '/demo_geometric.png', updatedAt: '2026-09-15T08:00:00', updatedLabel: '1d ago' },
];
const quickTools = [
  { id: 'pattern', label: 'Pattern Extraction', icon: 'M1 1' },
  { id: 'seamless', label: 'Make Seamless', icon: 'M1 1' },
  { id: 'imagelayers', label: 'Qwen Studio', icon: 'M1 1', requiresPro: true },
  { id: 'exports', label: 'Exports', icon: 'M1 1' }, // not in Quick Start: must not render
];

function renderHome(overrides = {}) {
  const props = {
    user, projects, quickTools,
    activeProject: projects[0],
    setTool: vi.fn(), onNewProject: vi.fn(), openProject: vi.fn(),
    renameProject: vi.fn(), deleteProject: vi.fn(), workspaceBusyId: null, currentToken: 't',
    ...overrides,
  };
  return { ...render(<HomeTool {...props} />), props };
}

describe('HomeTool', () => {
  it('greets the user by first name', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Preeti/);
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/Sharma/);
  });

  it('marks Embroidery and Woven as coming soon and only Print as openable', () => {
    const { props } = renderHome();
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Open Print Studio/ }));
    expect(props.setTool).toHaveBeenCalledWith('pattern');
    expect(screen.queryByRole('button', { name: /Open Embroidery/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open Woven/ })).toBeNull();
  });

  it('shows Quick Start tiles for real tools only, with a Pro badge where the tool needs it', () => {
    const { props } = renderHome();
    fireEvent.click(screen.getByRole('button', { name: /Make Seamless/ }));
    expect(props.setTool).toHaveBeenCalledWith('seamless');
    expect(screen.getByRole('button', { name: /Qwen Studio/ }).textContent).toMatch(/Pro/);
    expect(screen.queryByRole('button', { name: /^Exports$/ })).toBeNull();
  });

  it('lists projects newest first, opens one on click, and offers New project', () => {
    const { props } = renderHome();
    const cards = screen.getAllByRole('article').filter((a) => a.className.includes('hm-project'));
    expect(cards[0].textContent).toMatch(/Spring Florals/);
    fireEvent.click(screen.getByRole('button', { name: 'Open Yarn Dyed Checks' }));
    expect(props.openProject).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getAllByRole('button', { name: /New project/ })[0]);
    expect(props.onNewProject).toHaveBeenCalled();
  });

  it('never shows a demo image for a project with no artwork (empty or backend /demo_ placeholder)', () => {
    renderHome();
    expect(document.querySelectorAll('.hm-project-thumb img')).toHaveLength(0);
    expect(document.querySelectorAll('.hm-project-blank')).toHaveLength(2);
  });

  it('refuses to delete the last remaining project', () => {
    renderHome({ projects: [projects[0]], activeProject: projects[0] });
    fireEvent.click(screen.getByRole('button', { name: /More actions for Spring Florals/ }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });
});

describe('NewProjectModal', () => {
  it('locked: cannot be closed and will not create without a name', () => {
    const onClose = vi.fn(); const onCreate = vi.fn();
    render(<NewProjectModal open locked onClose={onClose} onCreate={onCreate} />);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Create project/ }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/name/i);
  });

  it('creates with the trimmed name', () => {
    const onCreate = vi.fn();
    render(<NewProjectModal open locked onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '  Spring Florals  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Create project/ }));
    expect(onCreate).toHaveBeenCalledWith('Spring Florals');
  });

  it('unlocked: Escape and overlay click close it', () => {
    const onClose = vi.fn();
    render(<NewProjectModal open onClose={onClose} onCreate={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
