import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('passes every untouched Node compile argument and receiver through the diagnostic loader', () => {
  const program = `
    const capture = require('./scripts/visual/actual-instrumentation.cjs');
    const Module = require('node:module');
    let observed;
    Module.prototype._compile = function(...args) { observed = { receiver: this.marker, args }; return 'original'; };
    capture.installCapture();
    const result = Module.prototype._compile.call({ marker: 'same-receiver' }, 'untouched-source', '/not-a-playwright-file.cjs', 'commonjs-typescript', { untouched: true });
    process.stdout.write(JSON.stringify({ result, observed }));
  `;
  const output = execFileSync(process.execPath, ['-e', program], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_OPTIONS: '', RUNNER3D_ACTUAL_CAPTURE: 'exact-buffer-v1', RUNNER3D_ACTUAL_SCOPE: 'fixture' } });
  expect(output).toBe(JSON.stringify({ result: 'original', observed: { receiver: 'same-receiver', args: ['untouched-source', '/not-a-playwright-file.cjs', 'commonjs-typescript', { untouched: true }] } }));
});
