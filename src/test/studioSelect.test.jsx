import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StudioSelect from '../pages/StudioSelect';

const basicUser = { id: 1, name: 'Asha Rao', role: 'user', plan: 'basic' };
const proUser = { id: 2, name: 'Dev', role: 'user', plan: 'pro', isPro: true };

describe('StudioSelect', () => {
  it('renders the three studios and locks Pro-only ones for basic plans', () => {
    const onSelect = vi.fn();
    render(<StudioSelect user={basicUser} onSelect={onSelect} onLogout={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Choose your studio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Print studio' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Embroidery studio is locked on your plan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Woven studio is locked on your plan' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Print studio' }));
    expect(onSelect).toHaveBeenCalledWith('print');
  });

  it('routes locked studios to billing through the upgrade button', () => {
    const onSelect = vi.fn();
    render(<StudioSelect user={basicUser} onSelect={onSelect} />);

    const upgradeButtons = screen.getAllByRole('button', { name: 'View Pro plans' });
    expect(upgradeButtons).toHaveLength(2);
    fireEvent.click(upgradeButtons[0]);
    expect(onSelect).toHaveBeenCalledWith('print', { tool: 'billing' });
  });

  it('lets pro users preview embroidery and woven', () => {
    const onSelect = vi.fn();
    render(<StudioSelect user={proUser} onSelect={onSelect} />);

    const embroidery = screen.getByRole('button', { name: 'Open Embroidery studio' });
    expect(embroidery).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open Woven studio' })).toBeEnabled();
    expect(screen.getAllByText('Coming soon')).toHaveLength(1);
    expect(screen.getAllByText('Available')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'View Pro plans' })).toBeNull();

    fireEvent.click(embroidery);
    expect(onSelect).toHaveBeenCalledWith('embroidery');
  });

  it('calls onLogout from the top bar', () => {
    const onLogout = vi.fn();
    render(<StudioSelect user={basicUser} onSelect={() => {}} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
