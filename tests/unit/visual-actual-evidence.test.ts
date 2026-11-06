import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SOURCE_PINS, buildDiagnosticSource } from '../../scripts/visual/actual-instrumentation.cjs';

const sources = {
  core: readFileSync(SOURCE_PINS.core.relativePath, 'utf8'),
  matcher: readFileSync(SOURCE_PINS.matcher.relativePath, 'utf8'),
};
const hook = 'globalThis[Symbol.for("runner3d.visualActualCapture.v1")]';
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

function screenshotMethod(source: string): string {
  const start = source.indexOf('      async expectScreenshot(progress2, options) {');
  const end = source.indexOf('      async screenshot(progress2, options) {', start);
  if (start < 0 || end <= start) throw new Error('Pinned native method missing');
  return source.slice(start, end);
}

type Entry = Buffer | 'retry' | 'timeout';
async function replay(source: string, input: Entry[], expected: Buffer | undefined, closed = false) {
  const events: { kind: string; actual?: string; expected?: string; timeout?: number; options?: unknown; message?: string }[] = [];
  const sequence = input.slice();
  class ReplayTimeout extends Error {}
  const frame = {
    rafrafTimeout: async (_: unknown, timeout: number) => { events.push({ kind: 'rafraf', timeout }); },
    isNonRetriableError: (error: unknown) => error instanceof ReplayTimeout,
  };
  const script = new Script(`class ReplayPage { ${screenshotMethod(source)} }; ReplayPage`);
  const Constructor: unknown = script.runInNewContext({
    validateScreenshotOptions: (options: unknown) => { events.push({ kind: 'validate', options }); return 'png'; },
    getComparator: () => (actual: Buffer, reference: Buffer, options: unknown) => {
      events.push({ kind: 'compare', actual: hash(actual), expected: hash(reference), options });
      return actual.equals(reference) ? null : { errorMessage: 'Controlled replay mismatch', diff: Buffer.from('diff') };
    },
    isJavaScriptErrorInEvaluate: () => false, isInvalidSelectorError: () => false,
    compressCallLog: (logs: string[]) => logs, TimeoutError: ReplayTimeout,
  });
  if (typeof Constructor !== 'function') throw new Error('Native replay class did not compile');
  const page: unknown = Reflect.construct(Constructor, []);
  if (!page || typeof page !== 'object' || !('expectScreenshot' in page) || typeof page.expectScreenshot !== 'function') throw new Error('Native replay class lacks the screenshot method');
  Object.assign(page, {
    isClosed: () => closed,
    performActionPreChecks: async () => { events.push({ kind: 'precheck' }); },
    mainFrame: () => frame,
    screenshotter: { screenshotPage: async () => {
      events.push({ kind: 'capture' });
      const entry = sequence.shift();
      if (entry === 'retry') throw new Error('Controlled retryable capture failure');
      if (entry === 'timeout' || !entry) throw new ReplayTimeout('Controlled deadline');
      return entry;
    } },
  });
  const progress = { metadata: { log: [] }, log: (message: string) => { events.push({ kind: 'log', message }); } };
  const options = { expected, isNot: false, animations: 'disabled', scale: 'css', threshold: .2, maxDiffPixelRatio: .003 };
  try {
    const result: unknown = await page.expectScreenshot.call(page, progress, options);
    const returned = result && typeof result === 'object' && 'actual' in result ? result.actual : undefined;
    return { verdict: 'PASS', events, returnedActualSHA: Buffer.isBuffer(returned) ? hash(returned) : null, details: null };
  } catch (error) {
    const details = error && typeof error === 'object' && 'details' in error ? error.details : null;
    return { verdict: 'FAIL', events, returnedActualSHA: null, details: JSON.parse(JSON.stringify(details)) };
  }
}

describe('pinned, in-memory native screenshot diagnostics', () => {
  it('pins every installed implementation byte and package version', () => {
    expect(SOURCE_PINS.version).toBe('1.64.1');
    expect(Object.isFrozen(SOURCE_PINS)).toBe(true);
    for (const kind of ['core', 'matcher'] as const) {
      expect(hash(sources[kind])).toBe(SOURCE_PINS[kind].sha256);
      expect(Object.isFrozen(SOURCE_PINS[kind])).toBe(true);
      expect(Reflect.set(SOURCE_PINS[kind], 'sha256', '0'.repeat(64))).toBe(false);
    }
    for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
      expect(JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version).toBe(SOURCE_PINS.version);
    }
  });
  it.each(['core', 'matcher'] as const)('refuses even whitespace drift in the %s implementation', kind => {
    expect(() => buildDiagnosticSource(kind, sources[kind] + '\n')).toThrow('hash mismatch');
    expect(() => buildDiagnosticSource(kind, '')).toThrow('hash mismatch');
    expect(() => Reflect.apply(buildDiagnosticSource, null, ['unsupported', sources[kind]])).toThrow('hash mismatch');
  });
  it('changes only the two success payloads and one read-only comparator observer', () => {
    const patched = buildDiagnosticSource('core', sources.core);
    expect(() => new Script(patched)).not.toThrow();
    const method = screenshotMethod(patched);
    expect(method.match(/return \{ actual \};/g)).toHaveLength(3); // one original generation path plus two exposed success paths
    const restored = patched.split('\n').filter(line => !line.trimStart().startsWith(`${hook}?.observeComparison(`)).join('\n')
      .replaceAll('progress2.log(`screenshot matched expectation`);\n            return { actual };', 'progress2.log(`screenshot matched expectation`);\n            return {};');
    expect(restored).toBe(sources.core);
    expect(patched).not.toContain('update-snapshots');
  });
  it('adds only observers to the native matcher and leaves its options and decisions byte-identical', () => {
    const patched = buildDiagnosticSource('matcher', sources.matcher);
    expect(() => new Script(patched)).not.toThrow();
    const restored = patched.split('\n').map(line => {
      const at = line.indexOf(` ${hook}?.`);
      return at < 0 ? line : line.slice(0, at);
    }).join('\n');
    expect(restored).toBe(sources.matcher);
    expect(readFileSync(SOURCE_PINS.core.relativePath, 'utf8')).toBe(sources.core);
    expect(readFileSync(SOURCE_PINS.matcher.relativePath, 'utf8')).toBe(sources.matcher);
  });
  it('is an explicit no-op outside diagnostic mode', () => {
    const environment = { ...process.env };
    delete environment.RUNNER3D_ACTUAL_CAPTURE;
    delete environment.RUNNER3D_ACTUAL_SCOPE;
    expect(() => execFileSync(process.execPath, ['-e', "if (require('./scripts/visual/actual-instrumentation.cjs').installCapture() !== false) process.exit(2)"], {
      cwd: process.cwd(), env: environment, stdio: 'pipe',
    })).not.toThrow();
  });
  it('rejects ambiguous preload modes instead of silently disabling collection', () => {
    const run = (capture: string, scope: string) => execFileSync(process.execPath, ['-e', "require('./scripts/visual/actual-instrumentation.cjs').installCapture()"], {
      cwd: process.cwd(), env: { ...process.env, RUNNER3D_ACTUAL_CAPTURE: capture, RUNNER3D_ACTUAL_SCOPE: scope }, stdio: 'pipe',
    });
    expect(() => run('unexpected', 'fixture')).toThrow();
    expect(() => run('exact-buffer-v1', 'unexpected')).toThrow();
  });
  it.each([
    { isNot: true, update: 'none', mime: 'image/png' },
    { isNot: false, update: 'all', mime: 'image/png' },
    { isNot: false, update: 'changed', mime: 'image/png' },
    { isNot: false, update: 'missing', mime: 'image/png' },
    { isNot: false, update: 'none', mime: 'image/jpeg' },
  ])('rejects unsupported assertion modes before reading or writing a reference: $isNot/$update/$mime', entry => {
    const script = `
      const path = require('node:path');
      require('./scripts/visual/actual-instrumentation.cjs').installCapture();
      const hook = globalThis[Symbol.for('runner3d.visualActualCapture.v1')];
      try {
        hook.assertSupported({ testInfo: { file: path.resolve('tests/diagnostics/actual-equivalence.spec.ts') },
          expectedPath: path.resolve('artifacts/visual-actual/fixture-references/never-read.png'),
          state: { isNot: ${JSON.stringify(entry.isNot)} }, updateSnapshots: ${JSON.stringify(entry.update)}, mimeType: ${JSON.stringify(entry.mime)} });
        process.exit(2);
      } catch (error) { process.stdout.write(error.message); }
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(), env: { ...process.env, RUNNER3D_ACTUAL_CAPTURE: 'exact-buffer-v1', RUNNER3D_ACTUAL_SCOPE: 'fixture' }, encoding: 'utf8', stdio: 'pipe',
    });
    expect(output).toBe('Diagnostic requires positive PNG assertions and updateSnapshots none');
  });
});

describe('original and exposed native methods consume the same controlled Buffer sequences', () => {
  const a = Buffer.from('image-a'), b = Buffer.from('image-b'), c = Buffer.from('image-c');
  const patched = buildDiagnosticSource('core', sources.core);
  it.each([
    { name: 'first iteration expected match', sequence: [b], expected: b, verdict: 'PASS', returned: b },
    { name: 'previous-frame stability then final expected match', sequence: [a, b, b], expected: b, verdict: 'PASS', returned: b },
    { name: 'stable mismatch', sequence: [a, a], expected: b, verdict: 'FAIL', returned: null },
    { name: 'retryable capture failure', sequence: ['retry', b], expected: b, verdict: 'PASS', returned: b },
    { name: 'timeout after unstable images', sequence: [a, b, 'timeout'], expected: c, verdict: 'FAIL', returned: null },
    { name: 'generation path remains unchanged', sequence: [a, b, b], expected: undefined, verdict: 'PASS', returned: b },
  ] as const)('preserves $name', async ({ sequence, expected, verdict, returned }) => {
    const original = await replay(sources.core, [...sequence], expected);
    const diagnostic = await replay(patched, [...sequence], expected);
    expect(original.verdict).toBe(verdict); expect(diagnostic.verdict).toBe(verdict);
    expect(diagnostic.events).toEqual(original.events); expect(diagnostic.details).toEqual(original.details);
    expect(diagnostic.returnedActualSHA).toBe(returned ? hash(returned) : null);
    if (expected && verdict === 'PASS') expect(original.returnedActualSHA).toBeNull();
    // Equality refers to the same replay input sequence, not two independent browser executions.
  });
  it('preserves a closed page failure before sampling', async () => {
    const original = await replay(sources.core, [], b, true), diagnostic = await replay(patched, [], b, true);
    expect(original.verdict).toBe('FAIL'); expect(diagnostic).toEqual(original);
    expect(original.events.some(event => event.kind === 'capture')).toBe(false);
  });
});
