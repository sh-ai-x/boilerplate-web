import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Turnstile } from '../components/Turnstile';

describe('Turnstile', () => {
  it('renders nothing when siteKey is empty (dev-mode escape hatch)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<Turnstile siteKey="" onVerify={() => undefined} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('renders a widget container when siteKey is provided', () => {
    const { container } = render(
      <Turnstile siteKey="1x00000000000000000000AA" onVerify={() => undefined} />
    );
    // In jsdom, the cloudflare script doesn't actually load, but the component
    // does mount the container div with our testid.
    expect(container.querySelector('[data-testid="turnstile-widget"]')).toBeInTheDocument();
  });
});
