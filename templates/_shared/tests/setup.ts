import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-cleanup each rendered tree so queries do not see leftover DOM from
// the previous test (matters when SignedOut and SignedIn variants both
// render <button> elements with overlapping accessible names).
afterEach(() => {
  cleanup();
});
