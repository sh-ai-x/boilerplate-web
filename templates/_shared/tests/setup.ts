import '@testing-library/jest-dom/vitest';
import { beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  // Run BEFORE each test: clear the document of any leftover nodes from
  // previous tests. RTL cleanup may not fire reliably across the @vitejs
  // plugin-react fast refresh path on some test runners, so we belt-and-
  // suspenders: explicitly remove any leftover container divs from body.
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

afterEach(() => {
  cleanup();
});
