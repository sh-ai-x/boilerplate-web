import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ROOT is the portfolio package root (test file lives in tests/, so '../' is portfolio/).
const ROOT = new URL('..', import.meta.url).pathname;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe('portfolio template — non-goal enforcement', () => {
  it('contains NO Toss code anywhere (AC2)', () => {
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, 'app'))) {
      const content = readFileSync(f, 'utf8');
      if (/\b(toss|TossPayments)\b/.test(content)) offenders.push(f);
    }
    expect(offenders, `Toss code found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('contains NO Turnstile code anywhere (AC3)', () => {
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, 'app'))) {
      const content = readFileSync(f, 'utf8');
      if (/\b(turnstile|Turnstile)\b/.test(content)) offenders.push(f);
    }
    expect(offenders, `Turnstile code found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('contains NO email/password input (AC4)', () => {
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, 'app'))) {
      const content = readFileSync(f, 'utf8');
      if (/type="(email|password)"/.test(content)) offenders.push(f);
    }
    expect(offenders, `email/password input found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('uses shared GoogleSignInButton in layout (AC4)', () => {
    const layoutSrc = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8');
    expect(layoutSrc).toMatch(/GoogleSignInButton/);
  });

  it('guestbook server action enforces auth + length', () => {
    const src = readFileSync(join(ROOT, 'app/guestbook/actions.ts'), 'utf8');
    expect(src).toMatch(/1000/);
    expect(src).toMatch(/user\.id/);
    expect(src).toMatch(/guestbook_entries/);
  });

  it('portfolio content is DB-driven (no fs.readFile of MDX in components)', () => {
    const compSrc = readFileSync(join(ROOT, 'components/MdxContent.tsx'), 'utf8');
    expect(compSrc).toMatch(/compileMDX/);
    expect(compSrc).not.toMatch(/readFileSync|readFile/);
  });
});
