'use strict';

const { cleanup } = require('./cleanup');

/**
 * Run a list of pipeline steps in sequence. If any step throws, run
 * cleanup(targetFolder, opts) and re-throw. Each step is a sync or async
 * function: () => Promise<void> | void.
 *
 * Adding a new step = appending to the `steps` array; no copy-pasted
 * try/catch wrappers to maintain.
 */
async function runPipeline(targetFolder, opts, steps) {
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      cleanup(targetFolder, opts);
      throw e;
    }
  }
}

module.exports = { runPipeline };
