import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LandingPage from '../pages/LandingPage';

describe('Public landing page product examples', () => {
  it('shows the hero claims and the three worked finishing examples', () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage currentUser={null} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /India’s First AI Platform for Textile \/ Fashion Industry/i })).toBeInTheDocument();
    expect(screen.getByText(/Built in India\. Made for creative teams\./i)).toBeInTheDocument();
    expect(screen.getByText('689K')).toBeInTheDocument();
    expect(screen.getByText('3,530+')).toBeInTheDocument();
    expect(screen.getByText('20+')).toBeInTheDocument();
    // The three worked examples, each shown once.
    expect(screen.getByRole('heading', { name: 'Super Resolution' })).toBeInTheDocument();
    expect(screen.getByText('2x upscale')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Colorway Manager' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Remove Background' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Indigo rose floral colourway/i })).toBeInTheDocument();

    const sageOption = screen.getByRole('button', { name: 'Preview Sage clay colourway' });
    expect(sageOption).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(sageOption);
    expect(sageOption).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /Sage clay floral colourway/i })).toBeInTheDocument();

    // The remaining tools are listed as chips under "continue in the same project", not as
    // headings. The hero claims 13+ Print Studio tools and the page still names only these;
    // when the full tool grid is built, these become headings and the three examples above
    // appear twice.
    expect(screen.getByText('Vector Pro')).toBeInTheDocument();
    expect(screen.getByText('Qwen Studio')).toBeInTheDocument();
    expect(screen.getByLabelText('Compare original artwork with a super-resolution preview')).toBeInTheDocument();

    const sectionIds = [...container.querySelector('main').children].map((section) => section.id);
    expect(sectionIds.slice(0, 3)).toEqual(['top', 'studios', 'platform']);
    expect(screen.getByRole('heading', { name: 'How RIMI AI works' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Benefits' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByText('One project, every tool')).toBeInTheDocument();
    expect(screen.getByLabelText('RIMI AI connects the textile workflow')).toBeInTheDocument();

    const testimonialPortraits = [...container.querySelectorAll('.mk-testimonial-avatar img')];
    expect(testimonialPortraits.map((image) => image.getAttribute('src'))).toEqual([
      '/assets/marketing/testimonials/tanushri-roy.webp',
      '/assets/marketing/testimonials/stefania-scrivani.webp',
      '/assets/marketing/testimonials/emanuel-morelli.webp',
    ]);
  });

  it('shows the stock image when a purpose-made thumbnail is missing', () => {
    // The /assets/marketing/how/ thumbnails are added one at a time; a card whose file does not
    // exist yet must not show a broken-image icon.
    render(
      <MemoryRouter>
        <LandingPage currentUser={null} />
      </MemoryRouter>,
    );

    const card = screen.getByText('Make Seamless').closest('.mk-how-card');
    const img = card.querySelector('img');
    expect(img.getAttribute('src')).toBe('/assets/marketing/how/make-seamless.webp');

    fireEvent.error(img);
    expect(img.getAttribute('src')).toBe('/assets/marketing/rimi-seamless-after.webp');
  });
});
