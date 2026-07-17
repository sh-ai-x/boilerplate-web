'use strict';

const { cleanup } = require('./cleanup');

/**
 * Run a list of pipeline steps in sequence. If any step throws, run
 * cleanup(targetFolder, opts) and re-throw. Each step is a sync or async
 * function: () => Promise<void> | void.
 *
 * Adding a new step = appending to the `steps` array; no copy-pasted
 * try/catch wrappers to maintain.
 *
 * The cleanup return value (warnings) is logged to stderr here so callers
 * don't have to plumb it through. cleanup is library-pure; this is the
 * caller-side terminal-I/O layer that consumes its warnings.
 */
async function runPipeline(targetFolder, opts, steps) {
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      const result = cleanup(targetFolder, opts);
      for (const w of result.warnings) {
        process.stderr.write(`Warning: ${w}\n`);
      }
      throw e;
    }
  }
}

module.exports = { runPipeline };
