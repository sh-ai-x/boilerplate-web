import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderMdx } from '../components/MdxContent';

describe('portfolio — MDX render error handling (review-blocker #1)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('returns ok:true for well-formed MDX', async () => {
    const result = await renderMdx('# Hello\n\nA *short* paragraph.');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBeTruthy();
      expect(result.error).toBeUndefined();
    }
  });

  it('returns ok:false (not throw) for malformed MDX — an unmatched brace', async () => {
    const result = await renderMdx('{ unmatched brace }');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false (not throw) for an unclosed HTML tag', async () => {
    const result = await renderMdx('<div>this never closes');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
    }
  });

  it('logs the underlying MDX error to server-side console.error', async () => {
    await renderMdx('{ unmatched brace }');
    expect(errSpy).toHaveBeenCalled();
    const args = errSpy.mock.calls[0] as unknown[];
    expect(String(args[0])).toMatch(/MDX render failed/);
  });
});
