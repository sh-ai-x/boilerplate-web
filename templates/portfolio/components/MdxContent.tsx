import { compileMDX } from 'next-mdx-remote/rsc';
import type { ReactElement } from 'react';

export async function renderMdx(source: string): Promise<ReactElement> {
  const { content } = await compileMDX({ source, options: { parseFrontmatter: false } });
  return content;
}
