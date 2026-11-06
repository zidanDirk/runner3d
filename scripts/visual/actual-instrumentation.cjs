'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const SYMBOL = Symbol.for('runner3d.visualActualCapture.v1');
const MAX_BYTES = 10 * 1024 * 1024;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const SOURCE_PINS = Object.freeze({
  version: '1.64.1',
  core: Object.freeze({ relativePath: 'node_modules/playwright-core/lib/coreBundle.js', sha256: '829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d' }),
  matcher: Object.freeze({ relativePath: 'node_modules/playwright/lib/matchers/expect.js', sha256: '0e5d49c2c2b2fb2a20f60726153cb0bd109d0124394029035f43497a82b05eed' }),
});
const hook = 'globalThis[Symbol.for("runner3d.visualActualCapture.v1")]';

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Diagnostic source anchor mismatch');
  return source.replace(from, to);
}

/** Only validated installed source is transformed in memory. No package writes. */
function buildDiagnosticSource(kind, source) {
  const pin = SOURCE_PINS[kind];
  if (!pin || typeof source !== 'string' || sha(source) !== pin.sha256) throw new Error('Diagnostic source hash mismatch');
  if (kind === 'core') {
    const start = source.indexOf('      async expectScreenshot(progress2, options) {');
    const end = source.indexOf('      async screenshot(progress2, options) {', start);
    if (start < 0 || end < 0) throw new Error('Diagnostic screenshot method missing');
    const original = source.slice(start, end);
    if (original.split('return {};').length !== 3) throw new Error('Diagnostic success branches changed');
    const patched = original.replaceAll('return {};', 'return { actual };');
    source = source.slice(0, start) + patched + source.slice(end);
    const anchor = '  if (pixelsMismatchError || sizesMismatchError)\n    return { errorMessage: sizesMismatchError + pixelsMismatchError, diff: PNG.sync.write(diff2) };';
    return replaceOnce(source, anchor, `  ${hook}?.observeComparison({ mimeType, actualBuffer, expectedBuffer, options, count, maxDiffPixels, sizeMismatch: !!sizesMismatchError, encodeDiff: () => PNG.sync.write(diff2) });\n${anchor}`);
  }
  source = replaceOnce(source, '    this.kind = this.mimeType.startsWith("image/") ? "Screenshot" : "Snapshot";',
    `    this.kind = this.mimeType.startsWith("image/") ? "Screenshot" : "Snapshot"; ${hook}?.assertSupported(this);`);
  source = replaceOnce(source, '    const { actual, previous, diff: diff2, errorMessage, log, timedOut } = await page._expectScreenshot(expectScreenshotOptions);',
    `    const { actual, previous, diff: diff2, errorMessage, log, timedOut } = await page._expectScreenshot(expectScreenshotOptions); ${hook}?.record({ helper, testInfo, options: expectScreenshotOptions, actual, expected, errorMessage, timedOut, nativeDiff: diff2 });`);
  return replaceOnce(source, '  const result = helper.comparator(received, expected, helper.options);',
    `  const result = helper.comparator(received, expected, helper.options); ${hook}?.record({ helper, testInfo, options: helper.options, actual: received, expected, errorMessage: result?.errorMessage, timedOut: false, nativeDiff: result?.diff });`);
}

function comparisonOptions(options = {}) {
  const result = { comparator: options.comparator ?? 'pixelmatch', threshold: options.threshold ?? 0.2,
    maxDiffPixels: options.maxDiffPixels ?? null, maxDiffPixelRatio: options.maxDiffPixelRatio ?? null };
  if (result.comparator !== 'pixelmatch' && result.comparator !== 'ssim-cie94') throw new Error('Unsupported diagnostic comparator');
  if (!Number.isFinite(result.threshold) || result.threshold < 0 || result.threshold > 1) throw new Error('Invalid diagnostic threshold');
  for (const name of ['maxDiffPixels', 'maxDiffPixelRatio']) if (result[name] !== null && (!Number.isFinite(result[name]) || result[name] < 0)) throw new Error('Invalid diagnostic comparison limit');
  if (result.maxDiffPixelRatio !== null && result.maxDiffPixelRatio > 1) throw new Error('Invalid diagnostic ratio');
  return result;
}
const comparisonKey = (actualSha, expectedSha, options) => `${actualSha}:${expectedSha}:${JSON.stringify(comparisonOptions(options))}`;

function relativeInside(file) {
  if (typeof file !== 'string') throw new Error('Diagnostic path is missing');
  const full = path.resolve(file), relative = path.relative(ROOT, full).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Diagnostic path outside project');
  let current = ROOT;
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid diagnostic path');
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Diagnostic symlink forbidden');
  }
  return relative;
}
function png(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > MAX_BYTES || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Diagnostic actual must be a bounded PNG Buffer');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192) throw new Error('Invalid diagnostic PNG dimensions');
  return { width, height };
}
function captureOptions(options, matcher) {
  if (matcher !== 'toHaveScreenshot') return null;
  const clip = options.clip ? Object.fromEntries(['x', 'y', 'width', 'height'].map(name => [name, options.clip[name]])) : null;
  if (clip && Object.values(clip).some(value => !Number.isFinite(value))) throw new Error('Invalid diagnostic clip');
  return { animations: options.animations ?? 'disabled', caret: options.caret ?? 'hide', scale: options.scale ?? 'css',
    fullPage: options.fullPage ?? false, omitBackground: options.omitBackground ?? false, clip,
    maskCount: options.mask?.length ?? 0, maskColor: options.maskColor ?? null,
    styleSha256: typeof options.style === 'string' ? sha(options.style) : null,
    timeout: options.timeout ?? null };
}

function makeRecorder(scope) {
  const out = path.join(ROOT, 'artifacts/visual-actual', `${scope === 'fixture' ? 'fixture' : 'suite'}-instrumented/raw`);
  const metrics = new Map();
  const helpers = new WeakMap(), ordinals = new WeakMap();
  const collectorSha256 = { instrumentation: sha(fs.readFileSync(__filename)), preload: sha(fs.readFileSync(path.join(__dirname, 'actual-preload.cjs'))) };
  let records = 0, activeHelper = null;
  function writeJSON(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
  function flushIncomplete() {
    if (!activeHelper) return;
    const helper = activeHelper, metadata = helpers.get(helper); activeHelper = null; metrics.clear();
    if (!metadata) throw new Error('Diagnostic incomplete assertion identity missing');
    const folder = path.join(out, `${metadata.assertionId}-r${metadata.retry}-x${metadata.repeatEachIndex}`);
    relativeInside(out); relativeInside(folder);
    fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(folder);
    writeJSON(path.join(folder, 'assertion.json'), { schemaVersion: 1, ...metadata, eligibleForRelease: false,
      captureStatus: 'MISSING_BEFORE_NATIVE_RETURN', errorCode: 'NATIVE_RESULT_NOT_RETURNED',
      referenceSha256: sha(fs.readFileSync(helper.expectedPath)), actualPath: null, actualSha256: null,
      expectedPath: null, diffPath: null, options: { capture: captureOptions(helper.options, metadata.matcher), comparison: comparisonOptions(helper.options) },
      comparison: { status: 'FAIL', nativeResultReturned: false, differentPixels: null, allowedDiffPixels: null, sizeMismatch: null },
      proof: { method: 'native-matcher-buffer-v1', collectorSha256, sourcePins: SOURCE_PINS,
        nativeComparedActualSha256: null, returnedActualSha256: null, archivedActualSha256: null,
        byteEquality: false, nativeReturnedBytesEqual: false, metricExpectedBytesEqual: false, nativeMetricsMatched: false } });
  }
  function assertSupported(helper) {
    if (++records > 2000) throw new Error('Diagnostic assertion capacity exceeded');
    const info = helper.testInfo;
    const testFile = relativeInside(info.file), referencePath = relativeInside(helper.expectedPath);
    if (!(scope === 'fixture' ? testFile.startsWith('tests/diagnostics/') : testFile.startsWith('tests/e2e/'))) throw new Error('Diagnostic test scope mismatch');
    const allowed = scope === 'fixture' ? /^(?:artifacts\/visual-actual\/fixture-references\/|tests\/diagnostics\/).+\.png$/ : /^tests\/e2e\/[a-z0-9-]+\.spec\.ts-snapshots\/(?:github-macos-26\/)?[a-z0-9-]+\.png$/;
    if (!allowed.test(referencePath)) throw new Error('Diagnostic reference scope mismatch');
    if (helper.state.isNot || helper.updateSnapshots !== 'none' || helper.mimeType !== 'image/png') throw new Error('Diagnostic requires positive PNG assertions and updateSnapshots none');
    const stat = fs.lstatSync(helper.expectedPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES) throw new Error('Diagnostic reference missing or too large');
    if (activeHelper && activeHelper.testInfo === info) throw new Error('Concurrent image assertions are not supported by exact capture');
    if (activeHelper) flushIncomplete();
    const assertionOrdinal = (ordinals.get(info) ?? 0) + 1; ordinals.set(info, assertionOrdinal);
    const retry = Number.isSafeInteger(info.retry) ? info.retry : 0;
    const repeatEachIndex = Number.isSafeInteger(info.repeatEachIndex) ? info.repeatEachIndex : 0;
    const testId = String(info.testId);
    if (testId.length > 500) throw new Error('Invalid diagnostic test identifier');
    const assertionId = sha(`${testFile}\0${testId}\0${assertionOrdinal}`).slice(0, 32);
    helpers.set(helper, { assertionId, testId, testFile, assertionOrdinal, retry, repeatEachIndex,
      titlePath: Array.isArray(info.titlePath) ? info.titlePath : [], matcher: helper.matcherName, referencePath });
    metrics.clear(); activeHelper = helper;
  }
  function observeComparison(value) {
    if (value.mimeType !== 'image/png' || !activeHelper) return;
    png(value.actualBuffer); png(value.expectedBuffer);
    const actualSha = sha(value.actualBuffer), expectedSha = sha(value.expectedBuffer);
    const key = comparisonKey(actualSha, expectedSha, value.options);
    metrics.delete(key);
    metrics.set(key, { assertionId: helpers.get(activeHelper).assertionId, actualSha, expectedSha, actualBuffer: value.actualBuffer, expectedBuffer: value.expectedBuffer,
      count: value.count, allowedDiffPixels: value.maxDiffPixels,
      sizeMismatch: value.sizeMismatch, encodeDiff: value.encodeDiff });
    if (metrics.size > 16) metrics.delete(metrics.keys().next().value);
  }
  function record(value) {
    const metadata = helpers.get(value.helper);
    if (!metadata) throw new Error('Diagnostic assertion was not registered');
    if (activeHelper !== value.helper) throw new Error('Diagnostic native comparison scope mismatch');
    activeHelper = null;
    const expectedDimensions = png(value.expected), referenceSha256 = sha(value.expected);
    const options = { capture: captureOptions(value.options, metadata.matcher), comparison: comparisonOptions(value.options) };
    let actualSha256 = null, dimensions = null, metric;
    if (Buffer.isBuffer(value.actual)) {
      dimensions = png(value.actual); actualSha256 = sha(value.actual);
      metric = metrics.get(comparisonKey(actualSha256, referenceSha256, value.options));
    }
    if (metric && metric.assertionId !== metadata.assertionId) throw new Error('Diagnostic native comparison assertion mismatch');
    const nativeReturnedBytesEqual = !!metric && metric.actualBuffer.equals(value.actual);
    const metricExpectedBytesEqual = !!metric && metric.expectedBuffer.equals(value.expected);
    if (metric && (!nativeReturnedBytesEqual || !metricExpectedBytesEqual)) throw new Error('Diagnostic native comparison Buffer mismatch');
    const status = value.errorMessage ? 'FAIL' : 'PASS';
    const captureStatus = !actualSha256 ? 'MISSING_ACTUAL' : !metric ? 'MISSING_NATIVE_METRICS' : 'VERIFIED';
    const folder = path.join(out, `${metadata.assertionId}-r${metadata.retry}-x${metadata.repeatEachIndex}`);
    relativeInside(out); relativeInside(folder);
    fs.mkdirSync(out, { recursive: true });
    // Exclusive creation makes retries/collisions visible instead of overwriting evidence.
    fs.mkdirSync(folder);
    const expectedPath = path.join(folder, 'expected.png'); fs.writeFileSync(expectedPath, value.expected, { flag: 'wx' });
    let actualPath = null, archivedActualSha256 = null, byteEquality = false, diffPath = null;
    if (actualSha256) {
      actualPath = path.join(folder, 'actual.png'); fs.writeFileSync(actualPath, value.actual, { flag: 'wx' });
      const archived = fs.readFileSync(actualPath); archivedActualSha256 = sha(archived); byteEquality = archived.equals(value.actual);
      if (!byteEquality || archivedActualSha256 !== actualSha256) throw new Error('Diagnostic archive Buffer mismatch');
    }
    if (metric) {
      const diff = value.nativeDiff ?? metric.encodeDiff(); png(diff);
      diffPath = path.join(folder, 'diff.png'); fs.writeFileSync(diffPath, diff, { flag: 'wx' });
    }
    const report = { schemaVersion: 1, ...metadata, captureStatus, eligibleForRelease: false,
      actualPath: actualPath && relativeInside(actualPath), actualSha256, actualDimensions: dimensions,
      referenceSha256, expectedPath: relativeInside(expectedPath), expectedDimensions,
      diffPath: diffPath && relativeInside(diffPath), diffSource: !diffPath ? null : value.nativeDiff ? 'native-failure-diff-buffer' : 'native-comparison-diff-image', options,
      comparison: { status, differentPixels: metric?.count ?? null, allowedDiffPixels: metric?.allowedDiffPixels ?? null,
        sizeMismatch: metric?.sizeMismatch ?? null, timedOut: !!value.timedOut },
      proof: { method: 'native-matcher-buffer-v1',
        bufferRoute: metadata.matcher === 'toHaveScreenshot' ? 'server-comparator-rpc-archive' : 'supplied-buffer-comparator-archive',
        nativeAssertionId: metric?.assertionId ?? null, nativeComparedActualSha256: metric?.actualSha ?? null, serverComparedActualSha256: metric?.actualSha ?? null,
        returnedActualSha256: actualSha256, archivedActualSha256, byteEquality,
        nativeReturnedBytesEqual, metricExpectedBytesEqual,
        nativeMetricsMatched: !!metric, collectorSha256, sourcePins: SOURCE_PINS } };
    writeJSON(path.join(folder, 'assertion.json'), report);
    if (status === 'PASS' && captureStatus !== 'VERIFIED') throw new Error('Diagnostic success lacks exact native matcher evidence');
  }
  process.once('exit', flushIncomplete);
  return { assertSupported, observeComparison, record };
}

function installCapture() {
  if (process.env.RUNNER3D_ACTUAL_CAPTURE === undefined) return false;
  if (process.env.RUNNER3D_ACTUAL_CAPTURE !== 'exact-buffer-v1') throw new Error('Unknown diagnostic actual capture mode');
  if (globalThis[SYMBOL]) return true;
  const scope = process.env.RUNNER3D_ACTUAL_SCOPE;
  if (!['fixture', 'suite'].includes(scope)) throw new Error('Diagnostic scope must be fixture or suite');
  const files = Object.fromEntries(['core', 'matcher'].map(kind => [path.resolve(ROOT, SOURCE_PINS[kind].relativePath), kind]));
  for (const packageName of ['@playwright/test', 'playwright', 'playwright-core']) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', packageName, 'package.json'), 'utf8'));
    if (data.version !== SOURCE_PINS.version) throw new Error('Diagnostic Playwright version mismatch');
  }
  for (const [file, kind] of Object.entries(files)) {
    if (require.cache[file]) throw new Error('Diagnostic preload must run before Playwright is loaded');
    buildDiagnosticSource(kind, fs.readFileSync(file, 'utf8'));
  }
  const recorder = makeRecorder(scope);
  Object.defineProperty(globalThis, SYMBOL, { value: Object.freeze(recorder), configurable: false, writable: false });
  const compile = Module.prototype._compile;
  Module.prototype._compile = function compileDiagnostic(source, filename, ...remainingArguments) {
    const kind = files[path.resolve(filename)];
    return compile.call(this, kind ? buildDiagnosticSource(kind, source) : source, filename, ...remainingArguments);
  };
  return true;
}
module.exports = { SOURCE_PINS, buildDiagnosticSource, installCapture };
