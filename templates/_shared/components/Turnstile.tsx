'use client';
import { useEffect, useRef } from 'react';
export function Turnstile({ siteKey, onVerify, theme = 'auto', className }: { siteKey: string; onVerify: (t: string) => void; theme?: 'light' | 'dark' | 'auto'; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!siteKey) { console.warn('[Turnstile] siteKey empty; widget NOT rendered.'); return; }
    if (!document.getElementById('cf-turnstile-script')) {
      const s = document.createElement('script'); s.id = 'cf-turnstile-script'; s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; s.async = true; s.defer = true; document.head.appendChild(s);
    }
  }, [siteKey]);
  if (!siteKey) return null;
  return <div ref={ref} className={className} data-testid="turnstile-widget" />;
}
