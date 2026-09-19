import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PricingPage from '../pages/PricingPage';

describe('Public pricing page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the real one-time credit packs and expiry terms', () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    render(
      <MemoryRouter>
        <PricingPage currentUser={null} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Creative capacity, without another subscription/i })).toBeInTheDocument();
    expect(screen.getByText('7.5')).toBeInTheDocument();
    expect(screen.getByText(/AI credits\s*per ₹1/i)).toBeInTheDocument();
    expect(screen.getByText('₹528')).toBeInTheDocument();
    expect(screen.getByText('₹1,936')).toBeInTheDocument();
    expect(screen.getByText('₹8,712')).toBeInTheDocument();
    expect(screen.getByText('₹26,312')).toBeInTheDocument();
    expect(screen.getByText('30-day credit window')).toBeInTheDocument();
    expect(screen.getByText('Custom top-ups begin at ₹100.')).toBeInTheDocument();
  });
});
