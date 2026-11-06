import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture } from './release-fixture';

const sha = 'a'.repeat(40), id = 'preview-mvp-test';
const directory = `https://games.example.invalid/runner/releases/${id}/`;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const basicStep = 'Verify basic Preview HTTPS and exact artifact bytes';
const summaryStep = 'Summarize Preview identity, upload receipt and basic acceptance';

// Execute the actual inline workflow source, rather than a separately maintained
// implementation of its protocol. Only relative import resolution is adapted.
async function inlineStep(name: string): Promise<string> {
  const workflow = await readFile('.github/workflows/deploy-qiniu.yml', 'utf8');
  const section = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
  const source = section?.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS(?:\n|$)/)?.[1];
  if (!source) throw new Error(`Missing inline workflow step: ${name}`);
  return source.split('\n').map(line => line.slice(10)).join('\n').replace(/from '(\.\/scripts\/release\/[^']+)'/g,
    (_match, path: string) => `from '${pathToFileURL(resolve(path)).href}'`);
}

interface Request { method: string; url: string; redirect: string; hasSignal: boolean }
interface BasicReport { status: string; error?: string; previewURL?: string; plannedFiles?: number; uploadIntentObjects?: number; files: { path: string }[] }
interface Result { status: number | null; report: BasicReport; requests: Request[]; timeouts: number[]; stdout: string; stderr: string }
interface Options { mode?: string; url?: string; expectedSHA?: string; expectedBuild?: string; environment?: 'preview' | 'production'; tls?: string; corruptLocal?: boolean }

async function runBasic(options: Options = {}): Promise<Result> {
  let result: Result | undefined;
  await fixture(async (root, files) => {
    const release = { version: '0.14.0-beta', buildId: id, commit: sha, buildTime: '2026-11-06T01:02:03.000Z', environment: options.environment ?? 'preview' };
    const body = JSON.stringify(release);
    await writeFile(join(root, 'release.json'), body);
    files['release.json'] = { bytes: Buffer.byteLength(body), sha256: hash(body) };
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, release, files }));
    if (options.corruptLocal) await writeFile(join(root, 'assets/app.js'), 'tampered');
    const execution = await mkdtemp(join(tmpdir(), 'runner-preview-workflow-'));
    try {
      await symlink(root, join(execution, 'dist'));
      const policyURL = pathToFileURL(resolve('scripts/release/cache-policy.mjs')).href;
      const mock = `
        import { readFileSync, writeFileSync } from 'node:fs';
        import { releaseFilePolicy as mockPolicy } from ${JSON.stringify(policyURL)};
        const requests = [], timeouts = [];
        const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
        AbortSignal.timeout = ms => { timeouts.push(ms); return originalTimeout(process.env.MOCK_MODE === 'timeout' && ms === 30000 ? 5 : ms); };
        let manifestReads = 0;
        process.on('exit', () => writeFileSync('requests.json', JSON.stringify({ requests, timeouts })));
        globalThis.fetch = async (input, options) => {
          const url = new URL(input);
          requests.push({ method: options.method, url: url.href, redirect: options.redirect, hasSignal: options.signal instanceof AbortSignal });
          if (url.protocol !== 'https:' || options.method !== 'GET' || options.redirect !== 'error' || !url.href.startsWith(${JSON.stringify(directory)})) throw new Error('UNSAFE_TEST_REQUEST');
          const path = url.href.slice(${directory.length});
          if (!path) throw new Error('Directory defaults are intentionally unavailable');
          const mode = process.env.MOCK_MODE;
          if (mode === 'timeout') return await new Promise((resolve, reject) => {
            const keepAlive = setTimeout(() => reject(new Error('Timeout signal not enforced')), 1000);
            options.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
          });
          let bytes = readFileSync('dist/' + path);
          let mime = mockPolicy(path).mimeType;
          if (mode === '404' && path === 'index.html') return new Response('missing', { status: 404 });
          if (mode === 'html-error' && path.endsWith('.js')) mime = 'text/html';
          if (mode === 'bad-hash' && path.endsWith('.js')) bytes = Buffer.alloc(bytes.length, 120);
          if (mode === 'oversize' && path.endsWith('.js')) bytes = Buffer.concat([bytes, Buffer.from('x')]);
          if (mode === 'empty-body' && path.endsWith('.js')) return new Response(null, { headers: { 'content-type': mime } });
          if (path === 'release-manifest.json' && (mode === 'wrong-manifest' || (mode === 'manifest-drift' && ++manifestReads > 1))) bytes = Buffer.from('{}');
          // Deliberately no Cache-Control or HTTP redirect support. Basic Preview
          // must pass without changing the independent strict CDN policy.
          return new Response(bytes, { headers: { 'content-type': mime } });
        };
      `;
      const child = spawnSync(process.execPath, ['--input-type=module'], {
        cwd: execution, input: mock + '\n' + await inlineStep(basicStep), encoding: 'utf8', timeout: 5000,
        env: { PATH: process.env.PATH, RELEASE_TEST_URL: options.url ?? directory, RELEASE_BUILD_ID: options.expectedBuild ?? id,
          RELEASE_EXPECTED_COMMIT: options.expectedSHA ?? sha, NODE_TLS_REJECT_UNAUTHORIZED: options.tls ?? '1', MOCK_MODE: options.mode ?? 'pass' },
      });
      if (child.error) throw child.error;
      const transport = JSON.parse(await readFile(join(execution, 'requests.json'), 'utf8')) as { requests: Request[]; timeouts: number[] };
      result = { status: child.status, stdout: child.stdout, stderr: child.stderr, report: JSON.parse(await readFile(join(execution, 'artifacts/beta-release/preview/basic.json'), 'utf8')) as BasicReport, ...transport };
    } finally { await rm(execution, { recursive: true, force: true }); }
  }, options.environment);
  if (!result) throw new Error('Workflow test fixture did not execute');
  return result;
}

it('checks every original file over HTTPS GET, including explicit index, real GLBs and main JS, without strict CDN prerequisites', async () => {
  const result = await runBasic();
  expect(result.status, result.stderr).toBe(0); expect(result.report.status).toBe('PASS');
  expect(result.report.previewURL).toBe(directory + 'index.html');
  expect(result.report.plannedFiles).toBe(result.report.files.length - 1); // Manifest is fetched at both boundaries.
  expect(result.report.uploadIntentObjects).toBe(1);
  const paths = result.report.files.map(file => file.path);
  expect(paths).toContain('index.html'); expect(paths).toContain('release.json'); expect(paths).toContain('assets/app.js');
  expect(paths).toContain('models/generated/city-runner.glb');
  expect(paths.filter(path => path === 'release-manifest.json')).toHaveLength(2);
  expect(result.requests.every(request => request.method === 'GET' && request.redirect === 'error' && request.hasSignal)).toBe(true);
  expect(result.timeouts).toContain(120000); expect(result.timeouts).toContain(30000);
});

it.each([
  ['404', 'HTTP 404'], ['html-error', 'Incorrect MIME'], ['bad-hash', 'integrity mismatch'],
  ['oversize', 'Transfer exceeds'], ['empty-body', 'Missing response body'],
  ['wrong-manifest', 'integrity mismatch'], ['manifest-drift', 'integrity mismatch'], ['timeout', 'timeout'],
])('retains an actual FAIL report for %s', async (mode, error) => {
  const result = await runBasic({ mode });
  expect(result.status).toBe(1); expect(result.report.status).toBe('FAIL');
  expect(result.report.error?.toLowerCase()).toContain(error.toLowerCase());
  expect(result.requests.length).toBeGreaterThan(0);
  expect(result.stdout).toContain('"status": "FAIL"');
});

it.each([
  { url: directory.replace('https:', 'http:') }, { url: directory + '?token=forbidden' },
  { url: directory.replace('games.', 'user:pass@games.') }, { url: directory + '#fragment' },
  { expectedSHA: 'b'.repeat(40) }, { expectedSHA: sha.slice(0, 16) }, { expectedBuild: 'other' },
  { environment: 'production' as const }, { tls: '0' }, { corruptLocal: true },
])('rejects unsafe transport or unreviewed identity before any remote request: %j', async options => {
  const result = await runBasic(options);
  expect(result.status).toBe(1); expect(result.report.status).toBe('FAIL'); expect(result.requests).toHaveLength(0);
});

it('reports exact manifest identity and separates planned files, reused files and the additional Intent without claiming skipped acceptance passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runner-preview-summary-'));
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'dist'));
    await mkdir(join(root, 'artifacts/beta-release/uploads'), { recursive: true });
    const manifest = JSON.stringify({ files: { 'index.html': {}, 'release.json': {}, 'assets/app.js': {} } });
    await writeFile(join(root, 'dist/release-manifest.json'), manifest);
    await writeFile(join(root, `artifacts/beta-release/uploads/${id}.json`), JSON.stringify({ status: 'VERIFIED_EXISTING', uploaded: [], reused: ['index.html', 'release.json', 'assets/app.js', 'release-manifest.json'] }));
    const summary = join(root, 'summary.md');
    const child = spawnSync(process.execPath, ['--input-type=module'], { cwd: root, input: await inlineStep(summaryStep), encoding: 'utf8', timeout: 5000,
      env: { SOURCE_SHA: sha, BUILD_ID: id, RELEASE_TEST_URL: directory, UPLOAD_OUTCOME: 'success', BASIC_OUTCOME: 'skipped', GITHUB_STEP_SUMMARY: summary } });
    expect(child.status, child.stderr).toBe(0);
    const text = await readFile(summary, 'utf8');
    for (const required of [sha, id, hash(manifest), directory + 'index.html', 'including release-manifest.json): 4', 'Upload Intent object: 1', 'newly uploaded: 0', 'resume: 4', 'VERIFIED_EXISTING', 'FAIL / NOT COMPLETED', 'Strict CDN: separate non-blocking']) expect(text).toContain(required);
    expect(text).not.toContain('Basic HTTPS/integrity: PASS');
  } finally { await rm(root, { recursive: true, force: true }); }
});
