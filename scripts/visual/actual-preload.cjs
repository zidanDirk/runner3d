'use strict';
try {
  require('./actual-instrumentation.cjs').installCapture();
} catch (error) {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = path.resolve(__dirname, '../../artifacts/visual-actual');
  try {
    let current = path.resolve(__dirname, '../..');
    for (const part of ['artifacts', 'visual-actual']) {
      current = path.join(current, part);
      if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Diagnostic output symlink');
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `preload-error-${process.pid}.json`), JSON.stringify({ schemaVersion: 1, status: 'FAIL', errorCode: 'ACTUAL_CAPTURE_PRELOAD_REJECTED', eligibleForRelease: false }) + '\n', { flag: 'wx' });
  } catch { /* A rejected output path never becomes an alternative write target. */ }
  // Do not print source, environment, credentials or arbitrary raw error data.
  throw new Error('Exact actual capture preload rejected this environment');
}
