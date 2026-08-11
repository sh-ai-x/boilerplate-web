#!/usr/bin/env node
'use strict';

/**
 * Bundle cli/index.js (and its lib/* imports) into a single executable
 * dist/cli.js via esbuild.
 *
 * Why esbuild (not tsc): the CLI source is CommonJS .js, no type
 * annotations, no decorator metadata. A bundler is the right tool.
 * The spec calls out --platform=node --target=node18 --format=cjs
 * to match the engines field in package.json.
 *
 * Why not ship a per-file dist: degit + fs + readline imports get
 * tree-shaken + inlined into a single file, so npm publish only needs
 * to upload dist/cli.js (plus the templates referenced via degit
 * download URLs at runtime — no template payload is bundled).
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'cli', 'index.js');
const OUTFILE = path.join(ROOT, 'dist', 'cli.js');

function build() {
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: OUTFILE,
    // cli/index.js already starts with `#!/usr/bin/env node` and
    // esbuild preserves it on the first line, so no `banner` is needed
    // (adding one would produce a duplicate shebang and a SyntaxError).
    legalComments: 'none',
    // Mark nothing external — we want a single self-contained bundle
    // that does NOT require node_modules at runtime. degit is bundled
    // in, so the published package has zero runtime npm dependencies.
  });

  fs.chmodSync(OUTFILE, 0o755);
  const { size } = fs.statSync(OUTFILE);
  process.stdout.write(`dist/cli.js ${size} bytes\n`);
}

try {
  build();
} catch (err) {
  process.stderr.write(`build-cli failed: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
}
