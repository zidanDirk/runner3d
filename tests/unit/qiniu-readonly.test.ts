import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReadonlyTransport, READONLY_BUCKET, READONLY_EXISTING_KEY, verifyQiniuReadonly } from '../../scripts/release/qiniu-readonly.mjs';
import { urlsafe } from '../../scripts/release/kodo-client.mjs';

const AK = 'readonly-synthetic-access-key', SK = 'readonly-synthetic-secret-key';
const HASH = 'Fto5o-5ea0sNMlW_75VgGJCv2AcJ';
const BASE_STAT = { fsize: 297920, mimeType: 'model/gltf-binary', hash: HASH, md5: 'a'.repeat(32), cacheControl: 'public, max-age=31536000' };
const MISSING = 'runner/__readonly_verification__/missing-12345678-1234-1234-1234-123456789abc.glb';
const REGION = { hosts: [{ region: 'z2', up: { domains: ['up-z2.qiniup.com'] }, rs: { domains: ['rs-z2.qiniuapi.com'] }, rsf: { domains: ['rsf-z2.qiniuapi.com'] } }] };
const fixedNow = () => new Date('2026-10-25T01:02:03.000Z');
interface Controls {
  accessKey: string;
  queryStatus: number;
  existingStatus: number;
  missingStatus: number;
  existing: Record<string, unknown>;
  region: unknown;
}

/** Real loopback HTTP for non-standard Kodo 612; no Qiniu connection. */
async function withServer(run: (context: { controls: Controls; calls: { method: string; host: string; path: string }[]; fetcher: typeof fetch }) => Promise<void>): Promise<void> {
  const controls: Controls = { accessKey: AK, queryStatus: 200, existingStatus: 200, missingStatus: 612, existing: { ...BASE_STAT }, region: REGION };
  const calls: { method: string; host: string; path: string }[] = [], failures: string[] = [];
  const server = createServer((req, res) => {
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const target = new URL(String(req.headers['x-original-readonly-url']));
      calls.push({ method: req.method ?? '', host: target.hostname, path: target.pathname });
      if (req.method !== 'GET') throw new Error('Unexpected write');
      if (target.hostname === 'uc.qiniuapi.com' && target.pathname === '/v4/query') {
        if (target.searchParams.get('ak') !== controls.accessKey || target.searchParams.get('bucket') !== READONLY_BUCKET) throw new Error('Invalid query');
        send(controls.queryStatus, controls.queryStatus === 200 ? controls.region : { error: `${AK} ${SK} Authorization: forbidden-body` }); return;
      }
      if (!['rs-z2.qiniuapi.com', 'rs-z2.qbox.me'].includes(target.hostname) || !target.pathname.startsWith('/stat/')) throw new Error('Unexpected endpoint');
      const date = String(req.headers['x-qiniu-date']);
      const canonical = `GET ${target.pathname}\nHost: ${target.host}\nContent-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: ${date}\n\n`;
      const signature = createHmac('sha1', SK).update(canonical).digest('base64').replaceAll('+', '-').replaceAll('/', '_');
      if (req.headers.authorization !== `Qiniu ${controls.accessKey}:${signature}`) throw new Error('Invalid management signature');
      const key = Buffer.from(target.pathname.slice('/stat/'.length), 'base64url').toString().slice(`${READONLY_BUCKET}:`.length);
      if (key === READONLY_EXISTING_KEY) send(controls.existingStatus, controls.existingStatus === 200 ? controls.existing : { error: `${AK} ${SK} Qiniu signature-must-not-leak` });
      else if (/^runner\/__readonly_verification__\/missing-[a-f0-9-]{36}\.glb$/.test(key)) send(controls.missingStatus, controls.missingStatus === 200 ? BASE_STAT : { error: `${AK} ${SK} Authorization: do-not-log` });
      else throw new Error('Unexpected object key');
    } catch (error) { failures.push(error instanceof Error ? error.message : 'Synthetic protocol error'); send(500, { error: 'Synthetic protocol assertion failed' }); }
  });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No loopback address');
  const origin = `http://127.0.0.1:${address.port}`;
  const fetcher: typeof fetch = (input, init) => {
    const original = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers); headers.set('x-original-readonly-url', original.href);
    return fetch(new URL(original.pathname + original.search, origin), { ...init, headers });
  };
  try { await run({ controls, calls, fetcher }); expect(failures).toEqual([]); expect(calls.every(call => call.method === 'GET')).toBe(true); }
  finally { server.closeAllConnections(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); }
}

const run = (fetcher: typeof fetch, options: { accessKey?: string; timeoutMs?: number } = {}) => verifyQiniuReadonly({ accessKey: options.accessKey ?? AK, secretKey: SK, fetcher, now: fixedNow, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
describe('Qiniu read-only actual-client protocol through synthetic loopback', () => {
  it('accepts official qbox management backups without weakening GET-only validation', async () => withServer(async ({ fetcher, controls, calls }) => {
    const region = structuredClone(REGION);
    region.hosts[0]!.rs.domains.push('rs-z2.qbox.me');
    region.hosts[0]!.rsf.domains.push('rsf-z2.qbox.me');
    controls.region = region;
    const report = await run(fetcher);
    expect(report.status).toBe('PASS'); expect(report.requestCount).toBe(3); expect(report.writesExecuted).toBe(false);
    expect(report.region.endpoints?.rs).toEqual(['https://rs-z2.qiniuapi.com', 'https://rs-z2.qbox.me']);
    expect(report.region.endpoints?.rsf).toEqual(['https://rsf-z2.qiniuapi.com', 'https://rsf-z2.qbox.me']);
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  }));

  it('uses qbox management primary endpoints for both actual stat GETs', async () => withServer(async ({ fetcher, controls, calls }) => {
    const region = structuredClone(REGION);
    region.hosts[0]!.rs.domains = ['rs-z2.qbox.me', 'rs-z2.qiniuapi.com'];
    region.hosts[0]!.rsf.domains = ['rsf-z2.qbox.me', 'rsf-z2.qiniuapi.com'];
    controls.region = region;
    const report = await run(fetcher);
    expect(report.status).toBe('PASS'); expect(report.requestCount).toBe(3); expect(report.writesExecuted).toBe(false);
    expect(report.region.endpoints?.rs[0]).toBe('https://rs-z2.qbox.me');
    expect(calls.slice(1).every(call => call.host === 'rs-z2.qbox.me' && call.method === 'GET')).toBe(true);
  }));

  it('performs exactly three GETs for z2, validates the old GLB metadata and maps real HTTP612 to null', async () => withServer(async ({ fetcher, calls }) => {
    const report = await run(fetcher);
    expect(report).toMatchObject({ status: 'PASS', scope: 'synthetic-test', testedAt: fixedNow().toISOString(), bucket: 'supergames', writesExecuted: false, requestCount: 3 });
    expect(report.region).toEqual({ status: 'PASS', endpoints: { up: ['https://up-z2.qiniup.com'], rs: ['https://rs-z2.qiniuapi.com'], rsf: ['https://rsf-z2.qiniuapi.com'] } });
    expect(report.existingObject).toMatchObject({ status: 'PASS', key: READONLY_EXISTING_KEY, bytes: BASE_STAT.fsize, mimeType: BASE_STAT.mimeType, hash: HASH, md5: BASE_STAT.md5, cacheControl: BASE_STAT.cacheControl });
    expect(report.missingObject).toMatchObject({ status: 'PASS', httpStatus: 612, mappedToNull: true });
    expect(calls[0]).toEqual({ method: 'GET', host: 'uc.qiniuapi.com', path: '/v4/query' });
    expect(calls.slice(1).every(call => call.host === 'rs-z2.qiniuapi.com' && call.path.startsWith('/stat/'))).toBe(true);
    expect(report.requests.map(request => request.path)).toEqual(['/v4/query', '/stat/<entry-redacted>', '/stat/<entry-redacted>']);
    expect(JSON.stringify(report)).not.toContain(AK); expect(JSON.stringify(report)).not.toContain(SK); expect(JSON.stringify(report)).not.toContain('Authorization');
  }));

  it('accepts optional MD5 and Cache-Control absence without demanding a new immutable policy on the old object', async () => withServer(async ({ fetcher, controls }) => {
    delete controls.existing.md5; delete controls.existing.cacheControl;
    const report = await run(fetcher); expect(report.status).toBe('PASS');
    expect(report.existingObject).not.toHaveProperty('md5'); expect(report.existingObject).not.toHaveProperty('cacheControl');
  }));

  it.each([
    { fsize: 0 }, { fsize: -1 }, { fsize: 0.5 }, { fsize: Number.MAX_SAFE_INTEGER + 1 },
    { mimeType: 'text/html' }, { mimeType: null }, { hash: 'x'.repeat(28) }, { hash: HASH.slice(1) },
    { hash: Buffer.alloc(21).toString('base64url') }, { md5: 'bad-md5' }, { md5: null }, { cacheControl: 123 }, { cacheControl: null }, { cacheControl: 'public\r\nAuthorization: forbidden' }, { cacheControl: 'x'.repeat(1025) },
  ])('fails invalid stat metadata without sending the missing-object request: %j', async patch => withServer(async ({ fetcher, controls, calls }) => {
    Object.assign(controls.existing, patch);
    const report = await run(fetcher); expect(report.status).toBe('FAIL'); expect(report.writesExecuted).toBe(false); expect(report.existingObject.status).toBe('FAIL'); expect(calls).toHaveLength(2);
  }));

  it('validates multi-block Qiniu Hash format too', async () => withServer(async ({ fetcher, controls }) => {
    controls.existing.hash = Buffer.concat([Buffer.from([0x96]), Buffer.alloc(20, 1)]).toString('base64url');
    expect((await run(fetcher)).status).toBe('PASS');
  }));

  it('redacts free-text credential/signature metadata rather than logging it', async () => withServer(async ({ fetcher, controls }) => {
    controls.existing.cacheControl = `Authorization: Qiniu ${AK}:${SK}:do-not-print-signature`;
    const report = await run(fetcher); expect(report.status).toBe('PASS'); expect(report.existingObject.cacheControlRedacted).toBe(true);
    const encoded = JSON.stringify(report); for (const forbidden of [AK, SK, 'Authorization', 'do-not-print-signature']) expect(encoded).not.toContain(forbidden);
  }));

  it('never substitutes schema keys during defense-in-depth credential redaction', async () => withServer(async ({ fetcher, controls }) => {
    controls.accessKey = 'status';
    const report = await run(fetcher, { accessKey: 'status' }); expect(report.status).toBe('PASS'); expect(report.region.status).toBe('PASS');
    expect(report).not.toHaveProperty('[REDACTED]');
  }));

  it('redacts even a credential-looking valid Hash value and marks the redaction explicitly', async () => withServer(async ({ fetcher, controls }) => {
    controls.accessKey = HASH;
    const report = await run(fetcher, { accessKey: HASH });
    expect(report.status).toBe('PASS'); expect(report.existingObject.hash).toBe('[REDACTED]');
    expect(report.sensitiveValuesRedacted).toBe(true); expect(JSON.stringify(report)).not.toContain(HASH);
  }));

  it.each([612, 404, 401, 503])('fails an existing-object status %i and never prints the error body', async status => withServer(async ({ fetcher, controls, calls }) => {
    controls.existingStatus = status;
    const report = await run(fetcher); expect(report.status).toBe('FAIL'); expect(report.existingObject.status).toBe('FAIL'); expect(calls).toHaveLength(2);
    const encoded = JSON.stringify(report); expect(encoded).not.toContain(AK); expect(encoded).not.toContain(SK); expect(encoded).not.toContain('signature-must-not-leak');
  }));

  it.each([404, 503, 200])('does not mistake missing-object HTTP%i for a confirmed 612 null', async status => withServer(async ({ fetcher, controls }) => {
    controls.missingStatus = status;
    const report = await run(fetcher); expect(report.status).toBe('FAIL'); expect(report.missingObject.status).toBe('FAIL'); expect(report.missingObject.httpStatus).toBe(status); expect(report.writesExecuted).toBe(false);
  }));

  it('fails Region query errors before stat and without leaking API bodies', async () => withServer(async ({ fetcher, controls, calls }) => {
    controls.queryStatus = 503;
    const report = await run(fetcher); expect(report.status).toBe('FAIL'); expect(report.region.status).toBe('FAIL'); expect(calls).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain(AK); expect(JSON.stringify(report)).not.toContain(SK); expect(JSON.stringify(report)).not.toContain('forbidden-body');
  }));

  it.each(['up', 'rs', 'rsf'] as const)('rejects unrecognized %s Region endpoint before any stat', async service => withServer(async ({ fetcher, controls, calls }) => {
    const region = structuredClone(REGION); region.hosts[0]![service].domains = ['attacker.invalid']; controls.region = region;
    const report = await run(fetcher); expect(report.status).toBe('FAIL'); expect(report.errorCode).toBe('INVALID_REGION_ENDPOINT'); expect(calls).toHaveLength(1);
    expect(report.region).toMatchObject({ failure: { service, category: 'UNRECOGNIZED_DOMAIN', domainClass: 'other', index: 0 } });
  }));

  it.each(['up', 'rs', 'rsf'] as const)('rejects a credential-bearing %s backup and reports only its safe classification', async service => withServer(async ({ fetcher, controls, calls }) => {
    const region = structuredClone(REGION), rawHost = `${AK}:${SK}@attacker.invalid`;
    region.hosts[0]![service].domains.push(rawHost); controls.region = region;
    const report = await run(fetcher);
    expect(report).toMatchObject({ status: 'FAIL', errorCode: 'INVALID_REGION_ENDPOINT', requestCount: 1, writesExecuted: false });
    expect(report.region).toMatchObject({ failure: { service, category: 'CREDENTIALS', domainClass: 'not-a-host', index: 1 } });
    expect(calls).toHaveLength(1); expect(report.existingObject.status).toBe('NOT_RUN');
    const output = JSON.stringify(report); for (const value of [AK, SK, rawHost, 'attacker.invalid', 'Authorization']) expect(output).not.toContain(value);
  }));
});

describe('transport denies writes, redirects, alternate read paths and TLS downgrades', () => {
  const uc = () => `https://uc.qiniuapi.com/v4/query?${new URLSearchParams({ ak: AK, bucket: READONLY_BUCKET })}`;
  it.each(['PUT', 'POST', 'DELETE', 'PATCH', 'HEAD'])('rejects method %s before the underlying transport', async method => {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
    const transport = createReadonlyTransport({ accessKey: AK, missingKey: MISSING, fetcher });
    await expect(transport.fetcher(uc(), { method, redirect: 'error' })).rejects.toThrow('WRITE_METHOD_BLOCKED'); expect(calls).toBe(0);
  });

  it.each([
    'http://uc.qiniuapi.com/v4/query', 'https://attacker.invalid/v4/query',
    'https://uc.qiniuapi.com/delete/entry', 'https://rs-z2.qiniuapi.com/chgm/entry',
    'https://uc.qiniuapi.com/v4/query?ak=wrong&bucket=supergames',
    `https://uc.qiniuapi.com/v4/query?ak=${AK}&bucket=other`,
    `https://uc.qiniuapi.com/v4/query?ak=${AK}&bucket=supergames&extra=1`,
    `https://uc.qiniuapi.com/v4/query?ak=${AK}&ak=${AK}&bucket=supergames`,
  ])('rejects unsafe request %s before the underlying transport', async url => {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
    const transport = createReadonlyTransport({ accessKey: AK, missingKey: MISSING, fetcher });
    await expect(transport.fetcher(url, { redirect: 'error' })).rejects.toThrow(); expect(calls).toBe(0);
  });

  it('does not allow stat until Region is validated, nor unexpected keys after discovery', async () => {
    const calls: string[] = []; const fetcher: typeof fetch = async input => { calls.push(String(input)); return new Response(JSON.stringify(REGION)); };
    const transport = createReadonlyTransport({ accessKey: AK, missingKey: MISSING, fetcher });
    const validStat = `https://rs-z2.qiniuapi.com/stat/${urlsafe(`${READONLY_BUCKET}:${READONLY_EXISTING_KEY}`)}`;
    await expect(transport.fetcher(validStat, { redirect: 'error' })).rejects.toThrow('UNSAFE_READ_PATH'); expect(calls).toHaveLength(0);
    await transport.fetcher(uc(), { redirect: 'error' });
    await expect(transport.fetcher(`https://rs-z2.qiniuapi.com/stat/${urlsafe('supergames:other')}`, { redirect: 'error' })).rejects.toThrow('UNSAFE_READ_PATH');
    await expect(transport.fetcher(`${validStat}?extra=1`, { redirect: 'error' })).rejects.toThrow('UNSAFE_READ_PATH'); expect(calls).toHaveLength(1);
  });

  it.each(['follow', 'manual'] as const)('requires redirect:error instead of %s', async redirect => {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
    const transport = createReadonlyTransport({ accessKey: AK, missingKey: MISSING, fetcher });
    await expect(transport.fetcher(uc(), { redirect })).rejects.toThrow('UNSAFE_TRANSPORT'); expect(calls).toBe(0);
  });

  it('refuses disabled TLS validation before any request', async () => {
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
    try { const report = await run(fetcher); expect(report.status).toBe('FAIL'); expect(report.errorCode).toBe('TLS_DISABLED'); expect(calls).toBe(0); }
    finally { if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous; }
  });

  it.each([0, -1, 30001, 1.5])('rejects invalid timeout %i before any request', async timeoutMs => {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
    const report = await run(fetcher, { timeoutMs }); expect(report.status).toBe('FAIL'); expect(report.errorCode).toBe('INVALID_TIMEOUT'); expect(calls).toBe(0);
  });

  it('bounds a stalled fetch even if the injected fetcher ignores AbortSignal', async () => {
    const fetcher: typeof fetch = () => new Promise<Response>(() => {});
    const report = await run(fetcher, { timeoutMs: 10 }); expect(report.status).toBe('FAIL'); expect(report.errorCode).toBe('NETWORK_OR_TIMEOUT'); expect(report.requestCount).toBe(1);
  });

  it('bounds a stalled body and an oversized body before the client parses it', async () => {
    const stalled: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ start() {} }));
    const timed = await run(stalled, { timeoutMs: 10 }); expect(timed.status).toBe('FAIL'); expect(timed.errorCode).toBe('NETWORK_OR_TIMEOUT');
    const large = await run(async () => new Response('x'.repeat(256 * 1024 + 1)));
    expect(large.status).toBe('FAIL'); expect(large.errorCode).toBe('RESPONSE_TOO_LARGE');
  });

  it('reports malformed JSON and thrown sensitive errors only as safe codes', async () => {
    const malformed = await run(async () => new Response('{invalid'));
    expect(malformed.status).toBe('FAIL'); expect(malformed.errorCode).toBe('INVALID_REGION_JSON');
    const failed = await run(async () => { throw Error(`${AK} ${SK} Authorization: secret-signature`); });
    expect(failed.status).toBe('FAIL'); expect(failed.errorCode).toBe('NETWORK_OR_TIMEOUT');
    for (const value of [AK, SK, 'Authorization', 'secret-signature']) expect(JSON.stringify(failed)).not.toContain(value);
  });

  it('caps the full transport at three requests', async () => {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return new Response(JSON.stringify(REGION)); };
    const transport = createReadonlyTransport({ accessKey: AK, missingKey: MISSING, fetcher });
    for (let i = 0; i < 3; i++) await transport.fetcher(uc(), { redirect: 'error' });
    await expect(transport.fetcher(uc(), { redirect: 'error' })).rejects.toThrow('REQUEST_LIMIT'); expect(calls).toBe(3);
  });
});

describe('real operator CLI and manual workflow do not expose secrets or deploy', () => {
  it.each([false, true])('writes FAIL with zero network for missing credentials/unexpected arguments: %s', async extraArgs => {
    const root = await mkdtemp(join(tmpdir(), 'runner-qiniu-readonly-cli-'));
    const module = resolve('scripts/release/qiniu-readonly.mjs'), args = extraArgs ? ['--unexpected'] : [];
    const driver = `process.argv=['node',${JSON.stringify(module)},...${JSON.stringify(args)}];let calls=0;globalThis.fetch=()=>{calls++;throw Error('NETWORK_USED')};await import(${JSON.stringify(pathToFileURL(module).href)});if(calls)console.error('NETWORK_USED');`;
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { cwd: root, encoding: 'utf8', timeout: 5000, env: { PATH: '', ...(extraArgs ? { QINIU_AK: AK, QINIU_SK: SK } : {}) } });
      expect(child.status).toBe(1); expect(child.stdout).toContain('Qiniu readonly: FAIL; requests=0; writes=false'); expect(child.stderr).not.toContain('NETWORK_USED');
      const report = JSON.parse(await readFile(join(root, 'artifacts/qiniu-readonly/report.json'), 'utf8')) as { status: string; requestCount: number; writesExecuted: boolean; errorCode: string };
      expect(report).toMatchObject({ status: 'FAIL', requestCount: 0, writesExecuted: false, errorCode: extraArgs ? 'UNEXPECTED_ARGUMENTS' : 'INVALID_CREDENTIAL_CONFIG' });
      for (const value of [AK, SK, 'Authorization']) { expect(JSON.stringify(report)).not.toContain(value); expect(child.stdout + child.stderr).not.toContain(value); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('prints only a safe failure when the report directory cannot be created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runner-qiniu-readonly-io-'));
    try {
      await writeFile(join(root, 'artifacts'), 'not-a-directory');
      const child = spawnSync(process.execPath, [resolve('scripts/release/qiniu-readonly.mjs')], { cwd: root, env: { PATH: '' }, encoding: 'utf8', timeout: 5000 });
      expect(child.status).toBe(1); expect(child.stderr).toContain('REPORT_IO_FAILURE'); expect(child.stderr).not.toContain(root);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps the workflow manual, Preview-only, read-permission-only and archives just the sanitized report', async () => {
    const workflow = await readFile('.github/workflows/qiniu-readonly.yml', 'utf8'), script = await readFile('scripts/release/qiniu-readonly.mjs', 'utf8');
    expect(workflow).toMatch(/\non:\n  workflow_dispatch:/); expect(workflow).not.toMatch(/^  (?:push|pull_request|schedule|workflow_run):/m);
    expect(workflow).toMatch(/permissions:\n  contents: read\n/); expect(workflow).not.toMatch(/(?:actions|deployments|id-token): write/);
    expect(workflow).toContain('environment: preview'); expect(workflow).toContain('needs: authorize'); expect(workflow).toContain('timeout-minutes: 5');
    expect(workflow).toContain('ref: ${{ github.sha }}'); expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('QINIU_AK: ${{ secrets.QINIU_AK }}'); expect(workflow).toContain('QINIU_SK: ${{ secrets.QINIU_SK }}');
    expect(workflow).toContain('if: always()'); expect(workflow).toContain('path: artifacts/qiniu-readonly/report.json'); expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).not.toContain('npm ci'); expect(workflow).not.toContain('deploy-qiniu.yml'); expect(workflow).not.toContain('qiniu.mjs');
    expect(script).not.toMatch(/\.(?:put|post|delete|patch)\(/); expect(script).not.toContain('QINIU_CREDENTIALS_FILE');
  });

  it('runs the actual inline authorization gate and rejects wrong SHA, bot/event or confirmation', async () => {
    const workflow = await readFile('.github/workflows/qiniu-readonly.yml', 'utf8');
    const body = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS/)?.[1]; if (!body) throw Error('No inline authorization gate');
    const sha = 'a'.repeat(40), environment = { EVENT_NAME: 'workflow_dispatch', SENDER_TYPE: 'User', SOURCE_SHA: sha, REVIEWED_SHA: sha, CONFIRMATION: `READONLY ${sha}`, PATH: '' };
    expect(spawnSync(process.execPath, ['--input-type=module', '-e', body], { env: environment, encoding: 'utf8' }).status).toBe(0);
    for (const bad of [{ EVENT_NAME: 'push' }, { SENDER_TYPE: 'Bot' }, { SOURCE_SHA: 'b'.repeat(40) }, { REVIEWED_SHA: 'a'.repeat(39) }, { CONFIRMATION: 'READONLY wrong' }]) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', body], { env: { ...environment, ...bad }, encoding: 'utf8' });
      expect(child.status).toBe(1); expect(child.stdout).not.toContain('accepted');
    }
  });
});
