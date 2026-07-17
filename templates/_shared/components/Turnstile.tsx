'use client';

import { useEffect, useRef } from 'react';

export interface TurnstileProps {
  /** Cloudflare Turnstile site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY). */
  siteKey: string;
  /** Called with the verified token. Server-side verification lives in the Edge Function. */
  onVerify: (token: string) => void;
  /** Optional Cloudflare theme: 'light' | 'dark' | 'auto'. */
  theme?: 'light' | 'dark' | 'auto';
  /** Optional className passthrough. */
  className?: string;
}

/**
 * Wraps Cloudflare's Turnstile widget. Renders NOTHING if siteKey is empty —
 * a deliberate dev-mode escape hatch so contributors can run the app without
 * a real Cloudflare account. A console.warn is emitted so the omission is
 * visible in dev tools.
 *
 * IMPORTANT: server-side verification (token → secret-key exchange) is
 * performed in the consuming template's Edge Function. This component
 * NEVER embeds the secret key.
 */
export function Turnstile({ siteKey, onVerify, theme = 'auto', className }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) {
      // Dev escape hatch — the dev sees the warning and the form proceeds
      // without Turnstile (Edge Function will reject in production with no
      // token; dev flow uses a stub).
      // eslint-disable-next-line no-console
      console.warn(
        '[Turnstile] siteKey is empty; widget NOT rendered. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY in .env.local.'
      );
      return;
    }

    const SCRIPT_ID = 'cf-turnstile-script';
    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    // Global callback registered by the script. We bind a stable handler so
    // multiple Turnstile instances can coexist.
    (window as unknown as { onTurnstileLoad?: () => void }).onTurnstileLoad = () => {
      if (!containerRef.current) return;
      // @ts-expect-error - turnstile is injected by the Cloudflare script
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        callback: (token: string) => onVerify(token),
      });
    };

    return () => {
      if (widgetIdRef.current) {
        // @ts-expect-error - turnstile is injected by the Cloudflare script
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onVerify, theme]);

  if (!siteKey) {
    // Render nothing — no widget, no fallback markup.
    return null;
  }

  return <div ref={containerRef} className={className} data-testid="turnstile-widget" />;
}
