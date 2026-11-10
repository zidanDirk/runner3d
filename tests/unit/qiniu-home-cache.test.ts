import { expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HOME_BUCKET, HOME_KEY, HOME_HASH, HOME_CONFIRMATION, maintainHomeCache } from '../../scripts/release/qiniu-home-cache.mjs';
import { createKodoClient, managementAuthorization } from '../../scripts/release/kodo-client.mjs';

const ak = 'synthetic-home-access-key', sk = 'synthetic-home-secret-key';
const at = new Date('2026-11-09T01:02:03.000Z'), date = '20261109T010203Z';
const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_');
const entry = b64('supergames:runner/index.html');
const original = { hash: HOME_HASH, fsize: 1234, mimeType: 'text/html', cacheControl: 'public, max-age=31536000' };
interface Call { url: URL; method: string; headers: Headers; body: BodyInit | null | undefined; redirect: RequestRedirect | undefined }
interface FixtureOptions {
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
  rs?: string; queryStatus?: number; statStatus?: number; postStatus?: number;
  loseWriteResponse?: boolean; loseReadback?: boolean;
}
function fixture(options: FixtureOptions = {}) {
  const calls: Call[] = []; let statCount = 0;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input), method = init.method ?? 'GET';
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body, redirect: init.redirect });
    const json = (value: unknown, status = 200) => {
      // Fetch can receive Kodo's 612/613, while the synthetic Response constructor
      // only accepts 200..599. Preserve the observed wire status explicitly.
      const response = new Response(JSON.stringify(value), { status: status > 599 ? 200 : status, headers: { 'content-type': 'application/json' } });
      if (status > 599) Object.defineProperty(response, 'status', { value: status });
      return response;
    };
    if (url.hostname === 'uc.qiniuapi.com' && url.pathname === '/v4/query' && method === 'GET') {
      return json({ hosts: [{ region: 'z2', up: { domains: ['up-z2.qiniup.com'] }, rs: { domains: [options.rs ?? 'rs-z2.qbox.me', 'rs-z2.qiniuapi.com'] }, rsf: { domains: ['rsf-z2.qbox.me', 'rsf-z2.qiniuapi.com'] } }] }, options.queryStatus);
    }
    if (!['rs-z2.qbox.me', 'rs-z2.qiniuapi.com'].includes(url.hostname)) throw new Error('Unexpected synthetic endpoint');
    if (method === 'GET' && url.pathname === `/stat/${entry}`) {
      statCount++;
      if (statCount > 1 && options.loseReadback) throw new Error(`${ak} ${sk} Authorization: never log this`);
      const value = statCount === 1 ? options.before === undefined ? original : options.before : options.after === undefined ? { ...original, cacheControl: 'no-store' } : options.after;
      return value === null ? json({ error: 'no such file' }, 612) : json(value, options.statStatus);
    }
    if (method === 'POST' && url.pathname.startsWith(`/chgm/${entry}/`)) {
      if (options.loseWriteResponse) throw new Error(`${ak} ${sk} Authorization: lost response after potential write`);
      if (options.postStatus && options.postStatus !== 200) return json({ error: `${ak} ${sk} Authorization: raw response must not escape` }, options.postStatus);
      // The official API returns HTTP 200 with no JSON/body on success.
      return new Response(null, { status: 200 });
    }
    throw new Error('Unexpected synthetic route or method');
  };
  const run = (extra: { execute?: boolean; confirmation?: string; timeoutMs?: number } = {}) => maintainHomeCache({ accessKey: ak, secretKey: sk, fetcher, now: () => at, ...extra });
  return { calls, run };
}
function assertSignedReadsAndSingleScope(calls: Call[]) {
  for (const call of calls) {
    expect(call.url.protocol).toBe('https:'); expect(call.redirect).toBe('error');
    expect(call.url.username).toBe(''); expect(call.url.password).toBe(''); expect(call.url.port).toBe('');
    if (call.url.hostname === 'uc.qiniuapi.com') {
      expect(call.method).toBe('GET'); expect(call.url.pathname).toBe('/v4/query');
      expect([...call.url.searchParams]).toEqual([['ak', ak], ['bucket', HOME_BUCKET]]);
      expect(call.headers.has('authorization')).toBe(false);
    } else {
      expect(call.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
      expect(call.headers.get('x-qiniu-date')).toBe(date);
      const canonical = `${call.method} ${call.url.pathname}${call.url.search}\nHost: ${call.url.host}\nContent-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: ${date}\n\n`;
      expect(call.headers.get('authorization')).toBe(`Qiniu ${ak}:${b64(createHmac('sha1', sk).update(canonical).digest())}`);
      expect(call.url.search).toBe('');
      if (call.method === 'GET') expect(call.url.pathname).toBe(`/stat/${entry}`);
      else expect(call.method).toBe('POST');
    }
  }
}

it('defaults to a read-only dry run of exactly the fixed bucket/key using the discovered z2 RS host', async () => {
  const f = fixture(), report = await f.run();
  expect(report).toMatchObject({ status: 'PASS', mode: 'dry-run', scope: 'synthetic-test', bucket: 'supergames', key: 'runner/index.html', writesAttempted: 0, writesAcknowledged: 0, cdnRefreshExecuted: false, before: original, after: null });
  expect(f.calls.map(c => c.method)).toEqual(['GET', 'GET']);
  expect(f.calls[1]?.url.hostname).toBe('rs-z2.qbox.me'); assertSignedReadsAndSingleScope(f.calls);
});

it.each(['rs-z2.qbox.me', 'rs-z2.qiniuapi.com'])('executes one correctly signed empty POST, cacheControl-only with original hash/fsize/mime conditions on %s', async rs => {
  const f = fixture({ rs }), report = await f.run({ execute: true, confirmation: HOME_CONFIRMATION });
  expect(report).toMatchObject({ status: 'PASS', outcome: 'UPDATED', mode: 'execute', writesAttempted: 1, writesAcknowledged: 1, before: original, after: { ...original, cacheControl: 'no-store' } });
  expect(f.calls.map(c => c.method)).toEqual(['GET', 'GET', 'POST', 'GET']);
  const post = f.calls[2]; if (!post) throw new Error('Missing POST');
  expect(post.url.origin).toBe(`https://${rs}`); expect(post.body).toBe('');
  const parts = post.url.pathname.split('/');
  expect(parts.slice(0, 4)).toEqual(['', 'chgm', entry, 'cacheControl']);
  expect(Buffer.from(parts[4] ?? '', 'base64url').toString()).toBe('no-store');
  expect(parts[5]).toBe('cond'); expect(parts).toHaveLength(7);
  expect(Buffer.from(parts[6] ?? '', 'base64url').toString()).toBe(`hash=${HOME_HASH}&fsize=1234&mime=text/html`);
  expect(post.url.pathname).not.toContain('/mime/'); expect(post.url.pathname).not.toContain('x-qn-meta');
  assertSignedReadsAndSingleScope(f.calls);
  const safe = JSON.stringify(report);
  for (const forbidden of [ak, sk, 'Authorization', post.headers.get('authorization') ?? 'invalid']) expect(safe).not.toContain(forbidden);
});

it.each(['', 'SET NO-STORE other:key', HOME_CONFIRMATION + ' '])('rejects ambiguous execution approval before any request: %j', async confirmation => {
  const f = fixture(), report = await f.run({ execute: true, confirmation });
  expect(report).toMatchObject({ status: 'FAIL', errorCode: 'EXPLICIT_CONFIRMATION_REQUIRED', writesAttempted: 0 }); expect(f.calls).toHaveLength(0);
});

it.each([
  null, { ...original, hash: 'A'.repeat(28) }, { ...original, fsize: 0 }, { ...original, fsize: -1 },
  { ...original, fsize: 1.1 }, { ...original, fsize: Number.MAX_SAFE_INTEGER + 1 },
  { ...original, mimeType: 'application/octet-stream' }, { ...original, mimeType: 'text/html\r\nInjected: value' },
  { hash: HOME_HASH, fsize: 1234, mimeType: 'text/html' },
  { ...original, cacheControl: 'public, max-age=31536000, no-store' }, { ...original, cacheControl: 'private' },
])('never writes when the authoritative pre-stat is missing, invalid or unexpected: %j', async before => {
  const f = fixture({ before }), report = await f.run({ execute: true, confirmation: HOME_CONFIRMATION });
  expect(report.status).toBe('FAIL'); expect(report.writesAttempted).toBe(0); expect(f.calls.some(c => c.method === 'POST')).toBe(false);
});

it.each([false, true])('does not mutate an already no-store object, execute=%s', async execute => {
  const f = fixture({ before: { ...original, cacheControl: 'no-store' } });
  expect(await f.run({ execute, confirmation: execute ? HOME_CONFIRMATION : '' })).toMatchObject({ status: 'PASS', outcome: 'UNCHANGED', writesAttempted: 0, writesAcknowledged: 0 });
  expect(f.calls.map(c => c.method)).toEqual(['GET', 'GET']);
});

it('stops on a 613 concurrency conflict without retrying or issuing a second mutation', async () => {
  const f = fixture({ postStatus: 613 }), report = await f.run({ execute: true, confirmation: HOME_CONFIRMATION });
  expect(report).toMatchObject({ status: 'FAIL', outcome: 'CONDITION_FAILED', errorCode: 'HTTP_613', writesAttempted: 1, writesAcknowledged: 0 });
  expect(f.calls.map(c => c.method)).toEqual(['GET', 'GET', 'POST']);
  expect(JSON.stringify(report)).not.toContain(ak); expect(JSON.stringify(report)).not.toContain(sk);
});

it.each([{ loseWriteResponse: true }, { loseReadback: true }])('reports an uncertain write/readback outcome without retrying: %j', async options => {
  const f = fixture(options), report = await f.run({ execute: true, confirmation: HOME_CONFIRMATION });
  expect(report).toMatchObject({ status: 'FAIL', outcome: 'UNKNOWN', errorCode: 'NETWORK_OR_TIMEOUT', writesAttempted: 1 });
  expect(report.writesAcknowledged).toBe(options.loseReadback ? 1 : 0);
  expect(f.calls.filter(c => c.method === 'POST')).toHaveLength(1);
  for (const forbidden of [ak, sk, 'Authorization', 'lost response']) expect(JSON.stringify(report)).not.toContain(forbidden);
});

it.each([
  { ...original, hash: 'A'.repeat(28), cacheControl: 'no-store' },
  { ...original, fsize: 1235, cacheControl: 'no-store' },
  { ...original, mimeType: 'text/plain', cacheControl: 'no-store' }, original,
])('does not declare success when post-stat content identity or caching differs: %j', async after => {
  const f = fixture({ after }), report = await f.run({ execute: true, confirmation: HOME_CONFIRMATION });
  expect(report.status).toBe('FAIL'); expect(report.outcome).toBe('UNKNOWN'); expect(report.writesAcknowledged).toBe(1);
  expect(f.calls.filter(c => c.method === 'POST')).toHaveLength(1);
});

it.each(['evil.invalid', 'rs-z2.qbox.me.evil.invalid', 'http://rs-z2.qbox.me', 'https://rs-z2.qbox.me'])('rejects malicious/HTTP/malformed discovered RS services without issuing a stat or write: %s', async rs => {
  const f = fixture({ rs }), report = await f.run({ execute: true, confirmation: HOME_CONFIRMATION });
  expect(report.status).toBe('FAIL'); expect(report.writesAttempted).toBe(0); expect(f.calls).toHaveLength(1);
});

it('rejects TLS downgrade before discovery; never follows a redirect or retries an upstream failure', async () => {
  const f = fixture(); vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
  try { expect(await f.run()).toMatchObject({ status: 'FAIL', errorCode: 'TLS_DISABLED' }); expect(f.calls).toHaveLength(0); }
  finally { vi.unstubAllEnvs(); }
  for (const status of [301, 401, 503]) {
    const bad = fixture({ queryStatus: status }), report = await bad.run({ execute: true, confirmation: HOME_CONFIRMATION });
    expect(report.status).toBe('FAIL'); expect(report.writesAttempted).toBe(0); expect(bad.calls).toHaveLength(1);
    expect(bad.calls[0]?.redirect).toBe('error');
  }
});

it('keeps legacy GET signatures unchanged and rejects unsupported management methods', () => {
  const url = `https://rs-z2.qbox.me/stat/${entry}`;
  const canonical = `GET /stat/${entry}\nHost: rs-z2.qbox.me\nContent-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: ${date}\n\n`;
  expect(managementAuthorization(ak, sk, url, date)).toBe(`Qiniu ${ak}:${b64(createHmac('sha1', sk).update(canonical).digest())}`);
  expect(() => Reflect.apply(managementAuthorization, undefined, [ak, sk, url, date, 'DELETE'])).toThrow('INVALID_MANAGEMENT_METHOD');
});

it('refuses unsafe metadata conditions before issuing discovery or a request', async () => {
  let calls = 0;
  const client = createKodoClient({ accessKey: ak, secretKey: sk, bucket: HOME_BUCKET }, { fetcher: async () => {
    calls++; throw new Error('Unexpected synthetic request');
  } });
  for (const expected of [{ ...original, mimeType: 'text/html&fsize=0' }, { ...original, fsize: 0 }, { ...original, hash: 'invalid' }]) {
    await expect(client.setNoStoreIfUnchanged(HOME_KEY, expected)).rejects.toThrow('INVALID_METADATA_CONDITION');
  }
  expect(calls).toBe(0);
});

it('honors the request timeout without allowing a follow-up write', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init = {}) => {
    calls++;
    const signal = init.signal;
    if (!signal) throw new Error('Missing timeout signal');
    return await new Promise<Response>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AbortSignal was not enforced')), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  };
  const report = await maintainHomeCache({ accessKey: ak, secretKey: sk, fetcher, timeoutMs: 5, execute: true, confirmation: HOME_CONFIRMATION });
  expect(report).toMatchObject({ status: 'FAIL', errorCode: 'NETWORK_OR_TIMEOUT', writesAttempted: 0 });
  expect(calls).toBe(1);
});

it.each([[], ['--dry-run'], ['--unknown'], ['--execute'], ['--execute', '--dry-run']].map(args => ({ args })))('CLI never requests anything without configuration/required approval, args=$args', async ({ args }) => {
  const root = await mkdtemp(join(tmpdir(), 'runner-home-cache-cli-'));
  try {
    const modulePath = resolve('scripts/release/qiniu-home-cache.mjs'), module = pathToFileURL(modulePath).href;
    const driver = `process.argv=['node',${JSON.stringify(modulePath)},...${JSON.stringify(args)}];let calls=0;globalThis.fetch=()=>{calls++;throw Error('UNEXPECTED_NETWORK')};process.on('exit',()=>{if(calls)console.error('UNEXPECTED_NETWORK')});await import(${JSON.stringify(module)});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { cwd: root, env: { PATH: process.env.PATH, ...(args.includes('--execute') || args.includes('--unknown') ? { QINIU_AK: ak, QINIU_SK: sk } : {}) }, encoding: 'utf8', timeout: 5000 });
    expect(child.status).toBe(1); expect(child.stdout + child.stderr).not.toContain('UNEXPECTED_NETWORK');
    expect(child.stdout + child.stderr).not.toContain(ak); expect(child.stdout + child.stderr).not.toContain(sk);
    const report = JSON.parse(await readFile(join(root, 'artifacts/qiniu-home-cache/report.json'), 'utf8')) as { mode?: string; writesAttempted: number; status: string };
    expect(report.status).toBe('FAIL'); expect(report.writesAttempted).toBe(0);
    if (!args.length) expect(report.mode).toBe('dry-run');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('requires an explicitly reviewed manual master revision before secrets and never invokes deployment/CDN operations', async () => {
  const workflow = await readFile('.github/workflows/qiniu-home-cache.yml', 'utf8');
  expect(workflow).toContain('workflow_dispatch:'); expect(workflow).toContain('permissions:\n  contents: read');
  expect(workflow).toContain('options: [dry-run, execute]'); expect(workflow).toContain('default: dry-run');
  expect(workflow).toContain('needs: authorize'); expect(workflow).toContain('environment: preview');
  expect(workflow).toContain('persist-credentials: false'); expect(workflow).toContain('if: always()');
  expect(workflow).not.toContain('qiniu.mjs'); expect(workflow).not.toContain('deploy-qiniu'); expect(workflow).not.toContain('npm run');
  expect(workflow).not.toMatch(/\n  (?:push|pull_request|schedule):/);
  const source = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)
    ?.[1]?.split('\n').map(line => line.slice(10)).join('\n');
  if (!source) throw new Error('Missing workflow authorization source');
  const accepted = { EVENT_NAME: 'workflow_dispatch', SOURCE_REF: 'refs/heads/master', SENDER_TYPE: 'User', SOURCE_SHA: 'a'.repeat(40), REVIEWED_SHA: 'a'.repeat(40), MAINTENANCE_MODE: 'dry-run', CONFIRMATION: '' };
  for (const [changes, exit] of [
    [{}, 0], [{ MAINTENANCE_MODE: 'execute', CONFIRMATION: HOME_CONFIRMATION }, 0],
    [{ SOURCE_REF: 'refs/heads/codex/unreviewed' }, 1], [{ SOURCE_REF: 'refs/tags/master' }, 1],
    [{ EVENT_NAME: 'push' }, 1], [{ SENDER_TYPE: 'Bot' }, 1], [{ REVIEWED_SHA: 'b'.repeat(40) }, 1],
    [{ MAINTENANCE_MODE: 'execute' }, 1], [{ CONFIRMATION: HOME_CONFIRMATION }, 1],
  ] as const) {
    const child = spawnSync(process.execPath, ['--input-type=module'], { input: source, encoding: 'utf8', env: { ...accepted, ...changes }, timeout: 5000 });
    expect(child.status, child.stderr).toBe(exit);
  }
});
