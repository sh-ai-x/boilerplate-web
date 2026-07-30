import { compileMDX } from 'next-mdx-remote/rsc';
import type { ReactElement } from 'react';

/**
 * Result of compiling admin-authored MDX into a React element.
 *
 * - `ok: true`  -> compiled cleanly; `content` is safe to render.
 * - `ok: false` -> compile or render failed; `error` is the captured
 *                 message (server-side only — never forwarded to the client).
 *
 * Returning a tagged result (instead of throwing) lets the caller render
 * a controlled fallback (e.g. raw source in a <pre>) so that one
 * malformed admin-authored item cannot 500 the whole public route.
 */
export type MdxRenderResult =
  | { ok: true; content: ReactElement }
  | { ok: false; error: string };

/**
 * Compile an MDX source string into a React element.
 *
 * Any exception thrown by `compileMDX` (parse error, malformed JSX,
 * unsupported expression, etc.) is caught, logged on the server, and
 * surfaced as `{ ok: false, error }` so the route can render a
 * "Could not render this item" fallback instead of crashing.
 */
export async function renderMdx(source: string): Promise<MdxRenderResult> {
  try {
    const { content } = await compileMDX({ source, options: { parseFrontmatter: false } });
    return { ok: true, content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[portfolio] MDX render failed:', message);
    return { ok: false, error: message };
  }
}
