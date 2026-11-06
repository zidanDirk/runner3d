import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { SOURCE_PINS } from './actual-instrumentation.cjs';
import { visualHostFacts } from './platform.mjs';
import { visualSourceFacts, assertNoSnapshotUpdates } from './candidate.mjs';
import { getVisualContract, LEGACY_VISUAL_CONTRACT_ID, PROPOSED_VISUAL_CONTRACT_ID, REFERENCE_SET_SHA256, validateContractHostFacts, validateContractRuntimeFacts } from './contracts.mjs';
import { validateVisualReferences, APPROVED_PROPOSAL_SHA256 } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = 'artifacts/visual-actual';
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const phases = { 'approved-equivalence': ['20261013.0424.1', LEGACY_VISUAL_CONTRACT_ID], 'candidate-collect': ['20261021.0445.8', PROPOSED_VISUAL_CONTRACT_ID] };
const iso = () => new Date().toISOString();
export const collectorSourceHashes = () => ({ instrumentation: hash(readFileSync(join(ROOT, 'scripts/visual/actual-instrumentation.cjs'))), preload: hash(readFileSync(join(ROOT, 'scripts/visual/actual-preload.cjs'))) });
// These are the existing reviewed per-file options, not new tolerances.
export const COMPARISON_POLICIES = Object.freeze(Object.fromEntries([
  ['animation-visual', .22, .003], ['character-visual', .22, .003], ['city-visual', .22, .01],
  ['themes-visual', .22, .01], ['motion-visual', .22, .003], ['feel-visual', .2, .003],
  ['mobile-visual', .2, .003], ['progression-visual', .2, .003], ['product-visual', .2, null],
].map(([file, threshold, ratio]) => [`tests/e2e/${file}.spec.ts`, Object.freeze({ comparator: 'pixelmatch', threshold, maxDiffPixels: null, maxDiffPixelRatio: ratio })])));

function safeFile(root, path) {
  check(typeof path === 'string' && path.length < 1200 && !path.includes('\\') && !path.startsWith('/') && path.split('/').every(p => p && p !== '.' && p !== '..'), 'Invalid evidence path');
  let file = root;
  for (const part of path.split('/')) { file = join(file, part); check(!lstatSync(file).isSymbolicLink(), 'Evidence symlink forbidden'); }
  const stat = lstatSync(file); check(stat.isFile() && stat.size > 0 && stat.size <= 16 * 1024 * 1024, 'Invalid evidence file size');
  return readFileSync(file);
}
function json(path) { return JSON.parse(safeFile(ROOT, path).toString('utf8')); }
function save(path, value) {
  check(path.startsWith(`${OUT}/`) && path.split('/').every(p => p && p !== '.' && p !== '..'), 'Invalid evidence output');
  let current = ROOT;
  for (const part of path.split('/')) { current = join(current, part); check(!lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink(), 'Evidence output symlink forbidden'); }
  mkdirSync(dirname(join(ROOT, path)), { recursive: true }); writeFileSync(join(ROOT, path), JSON.stringify(value, null, 2) + '\n');
}
function png(bytes) {
  check(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid evidence PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  check(width > 0 && height > 0 && width <= 8192 && height <= 8192, 'Invalid evidence PNG dimensions'); return { width, height };
}

/** Independent diagnostics are never a new approval selector. */
export function currentActualSelection() {
  assertNoSnapshotUpdates(process.argv);
  check(process.env.RUNNER3D_VISUAL_PLATFORM === undefined, 'Actual diagnostics require no formal platform selector');
  const phase = process.env.RUNNER3D_ACTUAL_PHASE;
  if (phase === 'local-verification') {
    check(process.env.GITHUB_ACTIONS !== 'true', 'Local verification cannot impersonate a GitHub validation');
    return { phase, expectedImage: null, contractId: null, snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}', eligibleForRelease: false };
  }
  const selected = phases[phase]; check(selected, 'Explicit approved-equivalence or candidate-collect phase required');
  check(process.env.RUNNER3D_ACTUAL_EXPECTED_IMAGE === selected[0], 'Exact diagnostic image request required');
  const facts = visualHostFacts(); validateContractHostFacts(getVisualContract(selected[1]), facts);
  const source = visualSourceFacts();
  check(/^[a-f0-9]{40}$/.test(process.env.RUNNER3D_ACTUAL_REVIEWED_SHA ?? '') && source.sourceSHA === process.env.RUNNER3D_ACTUAL_REVIEWED_SHA, 'Reviewed diagnostic source SHA mismatch');
  check(source.runId && source.runAttempt && source.runURL, 'Actual GitHub source context is required');
  check(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() === source.sourceSHA, 'Checkout source SHA mismatch');
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: ROOT, stdio: 'ignore' });
  for (const file of ['scripts/visual/actual-evidence.mjs', 'scripts/visual/actual-instrumentation.cjs', 'scripts/visual/actual-preload.cjs',
    'playwright.visual-actual.config.ts', 'playwright.visual-actual-fixture.config.ts', 'tests/diagnostics/actual-context-setup.ts', 'tests/diagnostics/actual-equivalence.spec.ts',
    'tests/unit/visual-actual-evidence.test.ts', 'tests/unit/visual-actual-manifest.test.ts', 'tests/unit/visual-actual-loader.test.ts', 'tests/unit/visual-actual-workflow.test.ts', '.github/workflows/visual-actual-evidence.yml']) {
    const committed = execFileSync('git', ['show', `${source.sourceSHA}:${file}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    check(committed.equals(readFileSync(join(ROOT, file))), 'Diagnostic code is not bound to the reviewed commit');
  }
  return { phase, expectedImage: selected[0], contractId: selected[1], snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/github-macos-26/{arg}{ext}', eligibleForRelease: false };
}

export function assertActualRuntime(selection, report) {
  if (selection.contractId) validateContractRuntimeFacts(getVisualContract(selection.contractId), {
    browserVersion: report.host.browser, actualFonts: report.actualFonts, renderer: report.renderer, vendor: report.vendor, devicePixelRatio: report.devicePixelRatio,
  });
  check(typeof report.host.browser === 'string' && report.actualFonts.length > 0 && typeof report.renderer === 'string', 'Actual browser fingerprint incomplete');
}

/** Re-read the bytes on disk and match them to the actual native comparison event. */
export function validateAssertionRecord(record, expectedReference, { root = ROOT } = {}) {
  check(record?.schemaVersion === 1 && record.captureStatus === 'VERIFIED' && record.eligibleForRelease === false, 'Missing exact matcher evidence');
  check(record.referencePath === expectedReference.path && record.referenceSha256 === expectedReference.sha256, 'Assertion reference binding mismatch');
  check(/^[a-f0-9]{32}$/.test(record.assertionId ?? '') && Number.isSafeInteger(record.assertionOrdinal) && record.assertionOrdinal > 0, 'Invalid assertion identity');
  check(record.retry === 0 && record.repeatEachIndex === 0, 'Retries cannot establish evidence equivalence');
  check(['toHaveScreenshot', 'toMatchSnapshot'].includes(record.matcher), 'Unsupported evidence matcher');
  check(record.testFile === expectedReference.path.split('-snapshots/')[0], 'Assertion test/reference location mismatch');
  const folder = `artifacts/visual-actual/suite-instrumented/raw/${record.assertionId}-r0-x0`;
  check(record.actualPath === `${folder}/actual.png` && record.expectedPath === `${folder}/expected.png` && record.diffPath === `${folder}/diff.png`, 'Unexpected assertion archive location');
  const actual = safeFile(root, record.actualPath), expected = safeFile(root, record.expectedPath), baseline = safeFile(root, expectedReference.path);
  check(hash(expected) === expectedReference.sha256 && expected.equals(baseline), 'Archived expected differs from reference');
  const actualHash = hash(actual), proof = record.proof;
  check(hash(actual) === record.actualSha256 && proof?.nativeComparedActualSha256 === actualHash && proof.returnedActualSha256 === actualHash && proof.archivedActualSha256 === actualHash, 'Native and archived actual hashes differ');
  check(proof.byteEquality === true && proof.nativeReturnedBytesEqual === true && proof.metricExpectedBytesEqual === true && proof.nativeMetricsMatched === true, 'Actual byte equality proof incomplete');
  check(proof.method === 'native-matcher-buffer-v1' && proof.nativeAssertionId === record.assertionId, 'Native assertion method/identity mismatch');
  check(JSON.stringify(proof.collectorSha256) === JSON.stringify(collectorSourceHashes()), 'Capture collector source hash mismatch');
  check(JSON.stringify(proof.sourcePins) === JSON.stringify(SOURCE_PINS), 'Capture source pins mismatch');
  const dimensions = png(actual), expectedDimensions = png(expected);
  check(JSON.stringify(dimensions) === JSON.stringify(record.actualDimensions) && JSON.stringify(expectedDimensions) === JSON.stringify(record.expectedDimensions), 'Evidence dimensions mismatch');
  check(['PASS', 'FAIL'].includes(record.comparison?.status) && typeof record.comparison.sizeMismatch === 'boolean' && typeof record.comparison.timedOut === 'boolean', 'Native comparison result missing');
  const { differentPixels, allowedDiffPixels } = record.comparison;
  check(Number.isSafeInteger(differentPixels) && differentPixels >= 0 && Number.isFinite(allowedDiffPixels) && allowedDiffPixels >= 0, 'Native comparison metrics invalid');
  check(record.comparison.sizeMismatch === (dimensions.width !== expectedDimensions.width || dimensions.height !== expectedDimensions.height), 'Native dimension result inconsistent');
  if (record.comparison.status === 'PASS') check(!record.comparison.sizeMismatch && !record.comparison.timedOut && differentPixels <= allowedDiffPixels, 'Native comparison metrics invalid');
  else check(record.comparison.sizeMismatch || record.comparison.timedOut || differentPixels > allowedDiffPixels, 'Native failure result inconsistent');
  const options = record.options?.comparison;
  const expectedOptions = expectedReference.comparisonOptions ?? COMPARISON_POLICIES[record.testFile];
  check(expectedOptions && options && Object.keys(expectedOptions).every(key => options[key] === expectedOptions[key]), 'Unexpected native comparator options');
  check((options.maxDiffPixels === null || Number.isFinite(options.maxDiffPixels) && options.maxDiffPixels >= 0) && (options.maxDiffPixelRatio === null || Number.isFinite(options.maxDiffPixelRatio) && options.maxDiffPixelRatio >= 0 && options.maxDiffPixelRatio <= 1), 'Invalid native comparator limits');
  const comparedWidth = Math.max(expectedDimensions.width, dimensions.width), comparedHeight = Math.max(expectedDimensions.height, dimensions.height);
  const limits = [options.maxDiffPixels, options.maxDiffPixelRatio === null ? null : comparedWidth * comparedHeight * options.maxDiffPixelRatio].filter(n => n !== null);
  check(allowedDiffPixels === (limits.length ? Math.min(...limits) : 0), 'Native allowed difference does not match options');
  if (record.matcher === 'toHaveScreenshot') check(record.options.capture?.scale === 'css' && record.options.capture.animations === 'disabled' && proof.bufferRoute === 'server-comparator-rpc-archive', 'Screenshot capture semantics differ');
  else check(proof.bufferRoute === 'supplied-buffer-comparator-archive', 'Direct Buffer evidence route mismatch');
  const diff = safeFile(root, record.diffPath); png(diff);
  return { ...record, actualSha256: actualHash, diffSha256: hash(diff), fileBytesEqualToReference: actual.equals(expected), eligibleForRelease: false };
}

function reportCases(report) {
  check(report && Array.isArray(report.suites) && Array.isArray(report.errors) && report.errors.length === 0, 'Invalid or failed Playwright report');
  const result = [];
  const visit = suite => { for (const spec of suite.specs ?? []) {
    check(spec.ok === true && Array.isArray(spec.tests) && spec.tests.length === 1, 'Unexpected test multiplicity or failure');
    const test = spec.tests[0]; check(test.status === 'expected' && test.results?.length === 1 && test.results[0].status === 'passed' && test.results[0].retry === 0, 'Skipped, failed, flaky or retried evidence');
    result.push({ file: spec.file.replaceAll('\\', '/'), title: spec.title, project: test.projectName });
  } for (const child of suite.suites ?? []) visit(child); };
  report.suites.forEach(visit);
  check(new Set(result.map(x => JSON.stringify(x))).size === result.length, 'Duplicate Playwright test identity');
  return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function compareTestReports(nativeReport, instrumentedReport) {
  const native = reportCases(nativeReport), instrumented = reportCases(instrumentedReport);
  check(native.length > 0 && JSON.stringify(native) === JSON.stringify(instrumented), 'Native and diagnostic test sets/results differ');
  return { status: 'PASS', tests: native.length, cases: native, eligibleForRelease: false };
}

export function validateApprovedProof(proof, expected, rawBytes) {
  check(/^[a-f0-9]{40}$/.test(expected.sourceSHA ?? '') && /^\d{1,20}$/.test(expected.runId ?? '') && /^\d{1,8}$/.test(expected.attempt ?? ''), 'Actual GitHub prerequisite identity is required');
  check(Buffer.isBuffer(rawBytes) && /^[a-f0-9]{64}$/.test(expected.proofSha256 ?? '') && hash(rawBytes) === expected.proofSha256, 'Approved prerequisite proof hash mismatch');
  check(JSON.stringify(JSON.parse(rawBytes.toString('utf8'))) === JSON.stringify(proof), 'Approved proof object differs from verified bytes');
  check(proof?.schemaVersion === 1 && proof.phase === 'approved-equivalence' && proof.status === 'PASS' && proof.eligibleForRelease === false, 'Invalid approved prerequisite');
  check(proof.sourceSHA === expected.sourceSHA && proof.runId === expected.runId && proof.attempt === expected.attempt, 'Approved proof source/run/attempt mismatch');
  check(proof.imageVersion === '20261013.0424.1' && proof.tests === 77 && proof.primaryAssertions === 91 && proof.totalAssertions === 151, 'Approved proof coverage incomplete');
  check(proof.fixtureEquivalence?.status === 'PASS' && proof.suiteEquivalence?.status === 'PASS' && proof.suiteEquivalence.tests === 77, 'Approved mechanism equivalence is missing');
  check(proof.referenceProposalSha256 === APPROVED_PROPOSAL_SHA256 && proof.referenceSetSha256 === REFERENCE_SET_SHA256, 'Approved reference set binding mismatch');
  check(JSON.stringify(proof.collectorSha256) === JSON.stringify(collectorSourceHashes()), 'Approved collector source mismatch');
  check(proof.context?.selection?.phase === 'approved-equivalence' && proof.context.selection.expectedImage === '20261013.0424.1', 'Approved phase context mismatch');
  check(proof.context.source?.sourceSHA === expected.sourceSHA && proof.context.source.runId === expected.runId && proof.context.source.runAttempt === expected.attempt, 'Approved browser provenance source mismatch');
  validateContractHostFacts(getVisualContract(LEGACY_VISUAL_CONTRACT_ID), proof.context.runner);
  assertActualRuntime({ contractId: LEGACY_VISUAL_CONTRACT_ID }, proof.context);
  check(JSON.stringify(proof.sourcePins) === JSON.stringify(SOURCE_PINS), 'Approved proof collector version mismatch');
  return true;
}

function walkJSON(directory) {
  if (!existsSync(directory)) return [];
  const paths = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    check(!item.isSymbolicLink(), 'Raw evidence symlink forbidden');
    const path = join(directory, item.name);
    if (item.isDirectory()) paths.push(...walkJSON(path));
    else if (item.name === 'assertion.json') paths.push(path);
  }
  check(paths.length <= 2000, 'Raw evidence count exceeded'); return paths;
}

export function buildCoverage(context, referenceReport, suiteReport) {
  const seen = new Set(), errors = [], verified = [];
  const records = [];
  let files = [];
  try { files = walkJSON(join(ROOT, OUT, 'suite-instrumented/raw')); } catch { errors.push('Raw evidence inventory is invalid'); }
  for (const path of files) {
    try { records.push(json(relative(ROOT, path).split('\\').join('/'))); }
    catch { errors.push({ path: relative(ROOT, path).split('\\').join('/'), reason: 'MALFORMED_OR_INCOMPLETE_ASSERTION_JSON' }); }
  }
  const reportedIds = new Map();
  const visit = suite => { for (const spec of suite.specs ?? []) reportedIds.set(spec.id, spec); for (const child of suite.suites ?? []) visit(child); };
  for (const suite of suiteReport?.suites ?? []) visit(suite);
  const primary = [], pressure = [];
  for (const record of records) {
    const key = `${record.testId}:${record.assertionOrdinal}`;
    if (seen.has(record.assertionId) || seen.has(key)) { errors.push('Duplicate assertion identity'); continue; }
    seen.add(record.assertionId); seen.add(key);
    const row = referenceReport.entries.find(row => (context.selection.phase === 'local-verification' ? row.original : row.platform) === record.referencePath);
    if (!row) { errors.push('Unknown reference in capture'); continue; }
    const ref = { path: record.referencePath, sha256: context.selection.phase === 'local-verification' ? row.originalSha256 : row.platformSha256 };
    try {
      const spec = reportedIds.get(record.testId);
      check(spec && record.testFile.endsWith(`/${spec.file}`) && record.titlePath?.includes(spec.title), 'Assertion identity is not in the completed test report');
      const valid = { ...validateAssertionRecord(record, ref), originalReference: { path: row.original, sha256: row.originalSha256 },
        platformReference: { path: row.platform, sha256: row.platformSha256 }, execution: context };
      verified.push(valid); (record.matcher === 'toHaveScreenshot' ? primary : pressure).push(valid);
    } catch (error) { errors.push({ assertionId: record.assertionId, reason: error.message }); }
  }
  const entries = referenceReport.entries.map(row => {
    const path = context.selection.phase === 'local-verification' ? row.original : row.platform;
    const matches = primary.filter(record => record.referencePath === path);
    return { assertionReferenceId: hash(row.original).slice(0, 32), referencePath: path,
      referenceSha256: context.selection.phase === 'local-verification' ? row.originalSha256 : row.platformSha256,
      status: matches.length === 1 ? matches[0].comparison.status === 'PASS' ? 'VERIFIED_EXACT_NATIVE_BUFFER' : 'VERIFIED_BUFFER_NATIVE_COMPARISON_FAILED' : matches.length ? 'DUPLICATE' : 'MISSING', assertion: matches.length === 1 ? matches[0] : null };
  });
  let testCount = null;
  try { testCount = reportCases(suiteReport).length; check(testCount === 77, 'Expected all 77 visual tests'); } catch (error) { errors.push(error.message); }
  const pressureValid = pressure.length === 60 && pressure.every(row => row.comparison.status === 'PASS' && row.testFile === 'tests/e2e/feel-visual.spec.ts' && row.referencePath.endsWith('/feel-dusk.png'));
  const complete = entries.length === 91 && entries.every(row => row.status === 'VERIFIED_EXACT_NATIVE_BUFFER') && records.length === 151 && verified.length === 151 && pressureValid && testCount === 77 && errors.length === 0;
  return { schemaVersion: 1, testedAt: iso(), status: complete ? 'PASS' : 'PARTIAL', eligibleForRelease: false,
    scope: context.selection.phase === 'local-verification' ? 'local-only-not-github-image-validation' : 'real-github-diagnostic',
    primaryExpected: 91, primaryVerified: entries.filter(r => r.assertion !== null).length,
    primaryComparisonsPassed: entries.filter(r => r.status === 'VERIFIED_EXACT_NATIVE_BUFFER').length,
    tests: testCount, totalAssertions: records.length, rawRecordFiles: files.length, pressureAssertions: pressure.length,
    context, sourcePins: SOURCE_PINS, collectorSha256: collectorSourceHashes(), errors, entries, pressure };
}

function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ['NODE_OPTIONS', 'RUNNER3D_VISUAL_PLATFORM', 'QINIU_AK', 'QINIU_SK', 'GITHUB_TOKEN', 'GH_TOKEN', 'RUNNER3D_ACTUAL_CAPTURE', 'RUNNER3D_ACTUAL_SCOPE']) delete env[key];
  return { ...env, ...extra };
}
async function child(args, extra = {}) {
  const code = await new Promise((done, reject) => {
    const processChild = spawn(process.execPath, args, { cwd: ROOT, env: childEnv(extra), shell: false, stdio: 'inherit' });
    processChild.once('error', reject); processChild.once('exit', code => done(code ?? 1));
  });
  check(code === 0, 'Diagnostic child failed; evidence remains partial');
}
const cli = ['node_modules/playwright/cli.js', 'test'];
function visualFiles() {
  const script = json('package.json').scripts['test:visual'];
  check(/^playwright test(?: tests\/e2e\/[a-z0-9-]+\.spec\.ts){10}$/.test(script), 'Unexpected visual suite command');
  return script.split(' ').slice(2);
}
const preloadEnv = scope => ({ RUNNER3D_ACTUAL_CAPTURE: 'exact-buffer-v1', RUNNER3D_ACTUAL_SCOPE: scope,
  NODE_OPTIONS: `--require=${join(ROOT, 'scripts/visual/actual-preload.cjs')}` });

async function fixtures() {
  await child(['node_modules/vitest/vitest.mjs', 'run', 'tests/unit/visual-actual-evidence.test.ts', 'tests/unit/visual-actual-manifest.test.ts', 'tests/unit/visual-actual-loader.test.ts', 'tests/unit/visual-actual-workflow.test.ts']);
  await child([...cli, '--config', 'playwright.visual-actual-fixture.config.ts'], { RUNNER3D_ACTUAL_FIXTURE_MODE: 'native' });
  await child([...cli, '--config', 'playwright.visual-actual-fixture.config.ts'], { ...preloadEnv('fixture'), RUNNER3D_ACTUAL_FIXTURE_MODE: 'instrumented' });
  const compared = compareTestReports(json(`${OUT}/fixture-native/report.json`), json(`${OUT}/fixture-instrumented/report.json`));
  const readVerdicts = mode => {
    const directory = join(ROOT, OUT, `fixture-${mode}/verdicts`);
    return readdirSync(directory).filter(name => name.endsWith('.json')).map(name => json(`${OUT}/fixture-${mode}/verdicts/${name}`)).sort((a,b) => a.caseId.localeCompare(b.caseId));
  };
  const native = readVerdicts('native'), diagnostic = readVerdicts('instrumented');
  check(native.length >= 6 && new Set(native.map(r => r.caseId)).size === native.length && native.length === diagnostic.length, 'Fixture coverage incomplete');
  for (let i = 0; i < native.length; i++) check(native[i].caseId === diagnostic[i].caseId && native[i].status === diagnostic[i].status && native[i].status === native[i].expectedStatus, 'Fixture native/diagnostic semantics differ');
  const raw = walkJSON(join(ROOT, OUT, 'fixture-instrumented/raw')).map(path => json(relative(ROOT, path).split('\\').join('/')));
  check(raw.length === native.length, 'Every fixture needs explicit capture or MISSING evidence');
  for (const verdict of diagnostic) {
    const found = raw.filter(r => r.titlePath.includes(verdict.caseId)); check(found.length === 1, 'Fixture assertion association missing');
    const record = found[0];
    if (verdict.status === 'PASS' || /stable wrong|different image dimensions/.test(verdict.caseId)) {
      check(record.captureStatus === 'VERIFIED' && record.comparison.status === verdict.status && record.proof.byteEquality && record.proof.nativeReturnedBytesEqual && record.proof.metricExpectedBytesEqual, 'Fixture native comparison evidence differs');
      const actual = safeFile(ROOT, record.actualPath);
      check(hash(actual) === record.actualSha256 && record.actualSha256 === record.proof.nativeComparedActualSha256, 'Fixture actual Buffer proof mismatch');
      if (verdict.actualBufferSHA) check(verdict.actualBufferSHA === record.actualSha256, 'Direct fixture Buffer not archived exactly');
      if (verdict.status === 'PASS') check(record.comparison.differentPixels === 0 && record.comparison.allowedDiffPixels === 0, 'Fixture native metrics changed');
      if (/different image dimensions/.test(verdict.caseId)) check(record.comparison.sizeMismatch === true, 'Dimension failure must remain a native size failure');
      if (/stable wrong/.test(verdict.caseId)) check(record.comparison.differentPixels > record.comparison.allowedDiffPixels, 'Mismatch failure lacks native differing pixels');
    } else check(record.actualPath === null && record.actualSha256 === null && record.captureStatus.startsWith('MISSING'), 'Missing actual fixture invented evidence');
  }
  const result = { ...compared, cases: native, method: 'pinned-native-source-replay-and-real-browser-fixtures' };
  save(`${OUT}/fixture-equivalence.json`, result); return result;
}

function observe() {
  const report = { schemaVersion: 1, testedAt: iso(), eligibleForRelease: false, source: visualSourceFacts(), runner: visualHostFacts() };
  try { report.selection = currentActualSelection(); report.status = 'HOST_MATCHED_DIAGNOSTIC_ONLY'; }
  catch { report.status = 'BLOCKED'; report.errorCode = 'ACTUAL_DIAGNOSTIC_HOST_MISMATCH'; save(`${OUT}/host.json`, report); throw new Error('Actual image unavailable or source context invalid; candidate collection remains blocked'); }
  save(`${OUT}/host.json`, report);
}

function validate() {
  const references = validateVisualReferences(), errors = [];
  let context;
  try { context = json(`${OUT}/context.json`); } catch { errors.push('Real browser context is MISSING'); }
  try {
    const selection = currentActualSelection();
    check(context && JSON.stringify(context.selection) === JSON.stringify(selection), 'Capture phase context mismatch');
    assertActualRuntime(selection, context);
    if (selection.phase !== 'local-verification') {
      const source = visualSourceFacts();
      check(context.source.sourceSHA === source.sourceSHA && context.source.runId === source.runId && context.source.runAttempt === source.runAttempt, 'Capture source/run context mismatch');
    }
  } catch (error) { errors.push(error.message); }
  context ??= { selection: { phase: process.env.RUNNER3D_ACTUAL_PHASE === 'local-verification' ? 'local-verification' : 'unverified-remote' }, contextStatus: 'MISSING', source: visualSourceFacts(), runner: visualHostFacts(), eligibleForRelease: false };
  let suite;
  try { suite = json(`${OUT}/suite-instrumented/report.json`); } catch { /* Missing tests are reported as partial. */ }
  const coverage = buildCoverage(context, references, suite);
  if (errors.length) {
    coverage.status = 'PARTIAL'; coverage.errors.push(...errors); coverage.primaryBufferVerified = coverage.primaryVerified; coverage.primaryVerified = 0;
    for (const row of coverage.entries) if (row.assertion) row.status = 'BUFFER_ONLY_CONTEXT_UNVERIFIED';
  }
  save(`${OUT}/manifest.json`, coverage);
  const columns = ['assertionReferenceId', 'status', 'assertionId', 'testFile', 'assertionOrdinal', 'referencePath', 'referenceSha256', 'actualPath', 'actualSha256',
    'comparison', 'differentPixels', 'allowedDiffPixels', 'threshold', 'maxDiffPixels', 'maxDiffPixelRatio', 'runId', 'attempt', 'sourceSHA', 'imageVersion', 'node', 'chromium', 'fonts', 'renderer', 'method', 'eligibleForRelease'];
  const rows = coverage.entries.map(row => {
    const a = row.assertion;
    return [row.assertionReferenceId, row.status, a?.assertionId, a?.testFile, a?.assertionOrdinal, row.referencePath, row.referenceSha256, a?.actualPath, a?.actualSha256,
      a?.comparison.status, a?.comparison.differentPixels, a?.comparison.allowedDiffPixels, a?.options.comparison.threshold, a?.options.comparison.maxDiffPixels, a?.options.comparison.maxDiffPixelRatio,
      context.source?.runId, context.source?.runAttempt, context.source?.sourceSHA, context.runner?.imageVersion, context.runner?.node,
      context.host?.browser, context.actualFonts?.map(font => font.postScriptName).join(';'), context.renderer, a?.proof.method, false];
  });
  const csv = value => '"' + String(value ?? 'MISSING_OR_NOT_APPLICABLE').replaceAll('"', '""') + '"';
  writeFileSync(join(ROOT, OUT, 'coverage.csv'), [columns, ...rows].map(row => row.map(csv).join(',')).join('\n') + '\n');
  writeFileSync(join(ROOT, OUT, 'coverage.md'), `# Exact native matcher evidence\n\nScope: ${coverage.scope}. Status: ${coverage.status}. eligibleForRelease: false.\n\nPrimary verified: ${coverage.primaryVerified}/91; tests: ${coverage.tests ?? 'MISSING'}/77; raw assertions: ${coverage.totalAssertions}/151.\n\nEach actual is the native comparison Buffer, not an adjacent screenshot. Missing remote identifiers in local mode remain MISSING.\n\n| Reference | Status | Actual SHA256 | Native differing / allowed pixels |\n| --- | --- | --- | --- |\n` + coverage.entries.map(row => `| ${row.referencePath} | ${row.status} | ${row.assertion?.actualSha256 ?? 'MISSING'} | ${row.assertion?.comparison.differentPixels ?? 'MISSING'} / ${row.assertion?.comparison.allowedDiffPixels ?? 'MISSING'} |`).join('\n') + '\n');
  check(coverage.status === 'PASS', 'Actual evidence coverage incomplete; see manifest MISSING rows'); return coverage;
}

async function run() {
  const selection = currentActualSelection();
  for (const sub of ['fixture-native', 'fixture-instrumented', 'suite-native', 'suite-instrumented']) check(!existsSync(join(ROOT, OUT, sub)), 'Existing diagnostic output must be archived explicitly before another run');
  save(`${OUT}/references-before.json`, validateVisualReferences());
  let fixtureEquivalence, suiteEquivalence;
  try {
    if (selection.phase === 'candidate-collect') {
      const bytes = safeFile(ROOT, `${OUT}/prerequisite/proof.json`), proof = JSON.parse(bytes.toString());
      validateApprovedProof(proof, { sourceSHA: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, proofSha256: process.env.RUNNER3D_ACTUAL_PROOF_SHA256 }, bytes);
    } else {
      fixtureEquivalence = await fixtures();
      await child([...cli, ...visualFiles(), '--config', 'playwright.visual-actual.config.ts'], { RUNNER3D_ACTUAL_SUITE_MODE: 'native' });
    }
    await child([...cli, ...visualFiles(), '--config', 'playwright.visual-actual.config.ts'], { ...preloadEnv('suite'), RUNNER3D_ACTUAL_SUITE_MODE: 'instrumented' });
    const coverage = validate();
    if (selection.phase !== 'candidate-collect') suiteEquivalence = compareTestReports(json(`${OUT}/suite-native/report.json`), json(`${OUT}/suite-instrumented/report.json`));
    if (selection.phase === 'approved-equivalence') {
      const context = coverage.context;
      const proof = { schemaVersion: 1, phase: selection.phase, status: 'PASS', eligibleForRelease: false,
        sourceSHA: context.source.sourceSHA, runId: context.source.runId, attempt: context.source.runAttempt,
        imageVersion: context.runner.imageVersion, tests: 77, primaryAssertions: 91, totalAssertions: 151,
        fixtureEquivalence, suiteEquivalence, context, sourcePins: SOURCE_PINS, collectorSha256: collectorSourceHashes(),
        referenceProposalSha256: APPROVED_PROPOSAL_SHA256, referenceSetSha256: REFERENCE_SET_SHA256 };
      save(`${OUT}/proof.json`, proof);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `proof_sha256=${hash(readFileSync(join(ROOT, OUT, 'proof.json')))}\n`);
    }
    save(`${OUT}/result.json`, { status: 'PASS', phase: selection.phase, eligibleForRelease: false, fixtureEquivalence, suiteEquivalence, remoteValidation: selection.phase === 'local-verification' ? 'NOT_PERFORMED' : 'DIAGNOSTIC_ONLY' });
  } finally {
    save(`${OUT}/references-after.json`, validateVisualReferences());
    try { validate(); } catch { /* Original failure stays visible; every expected point is listed even without context. */ }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const command = process.argv[2];
    if (command === 'observe') observe(); else if (command === 'validate') validate(); else if (command === 'run') await run();
    else throw new Error('Expected observe, run or validate');
  } catch (error) {
    save(`${OUT}/failure.json`, { status: 'FAIL', eligibleForRelease: false, errorCode: 'ACTUAL_EVIDENCE_INCOMPLETE', reason: error.message });
    console.error(`[visual-actual] ${error.message}`); process.exitCode = 1;
  }
}
