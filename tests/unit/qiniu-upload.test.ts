import { describe, expect, it } from 'vitest';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createKodoClient, kodoEtag, managementAuthorization, sha256, uploadToken } from '../../scripts/release/kodo-client.mjs';
import { prepareQiniuUpload, uploadQiniuCandidate, writeUploadCheckpoint } from '../../scripts/release/qiniu-upload.mjs';
import type { UploadCheckpoint, UploadPlan } from '../../scripts/release/qiniu-upload.mjs';
import { verifyRelease } from '../../scripts/release/verify.mjs';
import { fixture } from './release-fixture';
import { kodoServer, SYNTHETIC_AK, SYNTHETIC_SK } from './kodo-server';
import vectors from '../fixtures/qiniu/signature-vectors.json';

describe('official Kodo authentication and content identity', () => {
  it('matches the published upload-token HMAC/base64 vector, retaining padding', () => {
    const policy: Record<string, unknown> = JSON.parse(Buffer.from(vectors.upload.policyBase64, 'base64').toString());
    expect(uploadToken('MY_ACCESS_KEY', 'MY_SECRET_KEY', policy)).toBe(`MY_ACCESS_KEY:${vectors.upload.signature}:${vectors.upload.policyBase64}`);
  });
  it('matches the offline official Node SDK7.15.5 management-token vector', () => {
    expect(managementAuthorization('MY_ACCESS_KEY', 'MY_SECRET_KEY', vectors.management.uri, vectors.management.headers['X-Qiniu-Date'])).toBe(vectors.management.authorization);
  });
  it('verifies the ETag empty/single/multi-block boundary separately from SHA256', () => {
    expect(kodoEtag(Buffer.alloc(0))).toBe('Fto5o-5ea0sNMlW_75VgGJCv2AcJ');
    expect(kodoEtag(Buffer.alloc(4194305, 'a'))).toBe('lieGn00gWdbfwEIHaUpzu4drHeun');
    expect(sha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

async function withCloud(run: (context: { root: string; plan: UploadPlan; server: Awaited<ReturnType<typeof kodoServer>>; client: ReturnType<typeof createKodoClient>; receipts: UploadCheckpoint[]; checkpoint: (value: UploadCheckpoint) => Promise<void> }) => Promise<void>): Promise<void> {
  await fixture(async (root, files) => {
    for (const [path, contents] of Object.entries({ 'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'assets/app.css': 'body{color:red}' })) {
      await writeFile(join(root, path), contents);
      files[path] = { bytes: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex') };
    }
    const manifestPath = join(root, 'release-manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files = files; await writeFile(manifestPath, JSON.stringify(manifest));
    const plan = await prepareQiniuUpload({ directory: root, baseURL: 'https://games.example.invalid/runner/', bucket: 'synthetic-bucket' });
    const server = await kodoServer();
    const client = createKodoClient({ accessKey: SYNTHETIC_AK, secretKey: SYNTHETIC_SK, bucket: 'synthetic-bucket' }, { fetcher: server.transport });
    const receipts: UploadCheckpoint[] = [];
    const checkpoint = async (value: UploadCheckpoint) => { receipts.push(value); };
    try { await run({ root, plan, server, client, receipts, checkpoint }); expect(server.failures).toEqual([]); }
    finally { await server.close(); }
  });
}

describe('new-only immutable candidate upload through real multipart HTTP', () => {
  it('writes correct cache metadata on the FIRST PUT and preserves every file hash and BuildID', async () => withCloud(async ({ root, plan, server, client, checkpoint, receipts }) => {
    const before = await verifyRelease(root);
    const historical = Buffer.from('historical object');
    for (const key of ['runner/index.html', 'runner/releases/old/assets/app.js', 'runner/releases/old/models/runner.glb']) server.objects.set(key, { bytes: historical, mimeType: 'text/plain', cacheControl: 'legacy' });
    const result = await uploadQiniuCandidate(plan, client, { checkpoint });
    expect(result).toMatchObject({ status: 'COMPLETE', buildId: before.release.buildId, manifestSha256: before.manifestSha256, transport: 'injected-test-transport' });
    expect(result.uploaded).toHaveLength(plan.files.length);
    expect(server.puts).toHaveLength(plan.files.length + 1);
    expect(plan.files.some(file => file.key === plan.intent.key)).toBe(false);
    expect(server.puts[0]).toBe(plan.intent.key); expect(server.puts.at(-1)).toBe(`${plan.prefix}index.html`);
    expect(server.puts.at(-2)).toBe(`${plan.prefix}release-manifest.json`);
    for (const file of plan.files) {
      const remote = server.objects.get(file.key);
      expect(remote?.cacheControl).toBe(file.cacheControl); expect(remote?.mimeType).toBe(file.mimeType);
      expect(sha256(remote?.bytes ?? Buffer.alloc(0))).toBe(file.sha256);
      expect(await readFile(join(root, file.path))).toEqual(file.bytes);
    }
    expect(await verifyRelease(root)).toEqual(before);
    for (const key of ['runner/index.html', 'runner/releases/old/assets/app.js', 'runner/releases/old/models/runner.glb']) expect(server.objects.get(key)).toEqual({ bytes: historical, mimeType: 'text/plain', cacheControl: 'legacy' });
    expect(server.requests.every(request => request.method === 'GET' || request.method === 'POST' && request.path === '/')).toBe(true);
    expect(JSON.stringify(receipts)).not.toContain(SYNTHETIC_AK); expect(JSON.stringify(receipts)).not.toContain(SYNTHETIC_SK);
    expect(receipts.at(-1)?.status).toBe('COMPLETE');
  }));

  it('refuses any duplicate BuildID, even identical complete artifacts; explicit resume only verifies it', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    await uploadQiniuCandidate(plan, client, { checkpoint }); const attempts = server.puts.length;
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('DUPLICATE_BUILD_ID');
    expect(server.puts).toHaveLength(attempts);
    expect(await uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).toMatchObject({ status: 'VERIFIED_EXISTING', uploaded: [] });
    expect(server.puts).toHaveLength(attempts);
  }));

  it.each(['rejectUpload', 'rejectMetadata', 'loseResponse'] as const)('recovers safely from %s without overwriting acknowledged or ambiguous objects', async failure => withCloud(async ({ plan, server, client, receipts, checkpoint }) => {
    server.controls[failure] = 'assets/app.js';
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('RESUME_REQUIRED');
    expect(server.objects.has(`${plan.prefix}index.html`)).toBe(false);
    expect(receipts.at(-1)?.status).toBe('RESUME_REQUIRED');
    const original = new Map([...server.objects].map(([key, value]) => [key, sha256(value.bytes)]));
    const attempts = server.puts.length; server.controls[failure] = '';
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('DUPLICATE_BUILD_ID');
    expect(server.puts).toHaveLength(attempts);
    const resumed = await uploadQiniuCandidate(plan, client, { resume: true, checkpoint });
    expect(resumed.status).toBe('COMPLETE');
    for (const [key, hash] of original) { expect(sha256(server.objects.get(key)?.bytes ?? Buffer.alloc(0))).toBe(hash); expect(server.puts.slice(attempts)).not.toContain(key); }
  }));

  it('blocks metadata readback mismatch and does not try chgm, deletion, overwrite, or publishing an entry', async () => withCloud(async ({ plan, server, client, checkpoint, receipts }) => {
    server.controls.wrongMetadata = 'assets/app.js';
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('METADATA_MISMATCH');
    expect(receipts.at(-1)?.status).toBe('BLOCKED'); expect(server.objects.has(`${plan.prefix}index.html`)).toBe(false);
    const count = server.puts.length; server.controls.wrongMetadata = '';
    await expect(uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).rejects.toThrow('METADATA_MISMATCH');
    expect(server.puts).toHaveLength(count);
    expect(server.requests.some(request => /chgm|delete/.test(request.path))).toBe(false);
  }));

  it.each(['rejectUpload', 'loseResponse'] as const)('safely finalizes after %s on the LAST index, even when the original manifest already exists', async failure => withCloud(async ({ plan, server, client, checkpoint }) => {
    server.controls[failure] = 'index.html';
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('RESUME_REQUIRED');
    expect(server.objects.has(`${plan.prefix}release-manifest.json`)).toBe(true);
    const count = server.puts.length; server.controls[failure] = '';
    const result = await uploadQiniuCandidate(plan, client, { resume: true, checkpoint });
    expect(result.status).toBe(failure === 'loseResponse' ? 'VERIFIED_EXISTING' : 'COMPLETE');
    expect(server.puts.slice(count)).toEqual(failure === 'loseResponse' ? [] : [`${plan.prefix}index.html`]);
  }));

  it('binds resume to the original manifest and exact policy plan, not merely the same BuildID', async () => withCloud(async ({ root, plan, server, client, checkpoint }) => {
    await uploadQiniuCandidate(plan, client, { checkpoint }); const count = server.puts.length;
    const path = join(root, 'assets/app.js'), changed = Buffer.from('different reviewed artifact');
    await writeFile(path, changed);
    const manifestPath = join(root, 'release-manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files['assets/app.js'] = { bytes: changed.length, sha256: sha256(changed) }; await writeFile(manifestPath, JSON.stringify(manifest));
    const next = await prepareQiniuUpload({ directory: root, baseURL: 'https://games.example.invalid/runner/', bucket: 'synthetic-bucket' });
    expect(next.buildId).toBe(plan.buildId); expect(next.manifestSha256).not.toBe(plan.manifestSha256);
    await expect(uploadQiniuCandidate(next, client, { resume: true, checkpoint })).rejects.toThrow('CONTENT_MISMATCH');
    expect(server.puts).toHaveLength(count);
  }));

  it('blocks changed existing bytes, untrusted old partial folders and foreign objects before any new PUT', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    const first = plan.files[0]; if (!first) throw new Error('Missing fixture file');
    server.objects.set(first.key, { bytes: Buffer.from(first.bytes), mimeType: first.mimeType, cacheControl: first.cacheControl });
    await expect(uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).rejects.toThrow('UNTRUSTED_RESUME'); expect(server.puts).toHaveLength(0);
    server.objects.set(plan.intent.key, { bytes: Buffer.from(plan.intent.bytes), mimeType: plan.intent.mimeType, cacheControl: plan.intent.cacheControl });
    server.objects.set(first.key, { bytes: Buffer.from('changed'), mimeType: first.mimeType, cacheControl: first.cacheControl });
    await expect(uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).rejects.toThrow('CONTENT_MISMATCH'); expect(server.puts).toHaveLength(0);
    server.objects.set(`${plan.prefix}unreviewed.txt`, { bytes: Buffer.from('foreign'), mimeType: 'text/plain', cacheControl: 'no-store' });
    await expect(uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).rejects.toThrow('UNEXPECTED_REMOTE_OBJECT'); expect(server.puts).toHaveLength(0);
  }));

  it('handles a crash before the reservation and a racing insert-only reservation without touching assets', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    server.controls.reservationConflict = true;
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('HTTP_614');
    expect(server.puts).toEqual([plan.intent.key]); expect(server.objects.size).toBe(0);
    server.controls.reservationConflict = false;
    expect((await uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).status).toBe('COMPLETE');
  }));

  it('handles pagination correctly and rejects repeated markers without writing', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    await uploadQiniuCandidate(plan, client, { checkpoint }); const count = server.puts.length;
    server.controls.pageSize = 1;
    expect((await uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).status).toBe('VERIFIED_EXISTING');
    expect(server.puts).toHaveLength(count);
    server.controls.repeatedMarker = true;
    await expect(uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).rejects.toThrow('INVALID_INVENTORY'); expect(server.puts).toHaveLength(count);
  }));

  it('uses a captured byte snapshot even if dist changes later; rejects a changed manifest or unknown type before network', async () => withCloud(async ({ root, plan, server, client, checkpoint }) => {
    const file = plan.files.find(item => item.path === 'assets/app.js'); if (!file) throw new Error('No fixture JS');
    await writeFile(join(root, file.path), 'changed after snapshot');
    await uploadQiniuCandidate(plan, client, { checkpoint }); expect(server.objects.get(file.key)?.bytes).toEqual(file.bytes);
    await expect(prepareQiniuUpload({ directory: root, baseURL: 'https://games.example.invalid/runner/', bucket: 'synthetic-bucket' })).rejects.toThrow('integrity mismatch');
    await writeFile(join(root, file.path), file.bytes);
    const path = join(root, 'release-manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
    const bytes = Buffer.from('unreviewed'); await writeFile(join(root, 'unreviewed.bin'), bytes);
    manifest.files['unreviewed.bin'] = { bytes: bytes.length, sha256: sha256(bytes) }; await writeFile(path, JSON.stringify(manifest));
    await expect(prepareQiniuUpload({ directory: root, baseURL: 'https://games.example.invalid/runner/', bucket: 'synthetic-bucket' })).rejects.toThrow('No reviewed cache/MIME');
  }));

  it('requires a durable checkpoint before any cloud contact and can resume after a checkpoint fails following PUT', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    await expect(uploadQiniuCandidate(plan, client, { checkpoint: async () => { throw Error('disk full'); } })).rejects.toThrow('LOCAL_CHECKPOINT_OR_IO_FAILURE');
    expect(server.requests).toHaveLength(0);
    await expect(uploadQiniuCandidate(plan, client, { checkpoint: async value => { if (value.phase === 'verify-content-and-metadata') throw Error('disk full'); } })).rejects.toThrow('RESUME_REQUIRED');
    expect((await uploadQiniuCandidate(plan, client, { resume: true, checkpoint })).status).toBe('COMPLETE');
  }));

  it.each(['wrongReceipt', 'statFailure'] as const)('fails safely on %s and never leaks API error bodies or keys', async failure => withCloud(async ({ plan, server, client, checkpoint, receipts }) => {
    server.controls[failure] = 'assets/app.js';
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.not.toThrow(SYNTHETIC_SK);
    expect(server.objects.has(`${plan.prefix}index.html`)).toBe(false);
    expect(JSON.stringify(receipts)).not.toContain(SYNTHETIC_AK); expect(JSON.stringify(receipts)).not.toContain(SYNTHETIC_SK);
  }));

  it('rejects an untrusted discovered upload hostname before sending any token', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    server.controls.invalidUploadHost = true;
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('INVALID_UPLOAD_HOST'); expect(server.puts).toHaveLength(0);
  }));
  it('queries the actual Kodo UC host/path once and uses the discovered z2 up/rs/rsf over HTTPS', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    server.controls.regional = true;
    await uploadQiniuCandidate(plan, client, { checkpoint });
    expect(server.requests[0]).toEqual({ method: 'GET', host: 'uc.qiniuapi.com', path: '/v4/query', protocol: 'https:', redirect: 'error' });
    expect(server.requests.filter(request => request.path === '/v4/query')).toHaveLength(1);
    expect(server.requests.some(request => request.host === 'up-z2.qiniup.com' && request.method === 'POST' && request.path === '/')).toBe(true);
    expect(server.requests.some(request => request.host === 'rs-z2.qiniuapi.com' && request.path.startsWith('/stat/'))).toBe(true);
    expect(server.requests.some(request => request.host === 'rsf-z2.qiniuapi.com' && request.path === '/list')).toBe(true);
    expect(server.requests.every(request => request.protocol === 'https:' && request.redirect === 'error')).toBe(true);
    expect(server.requests.some(request => ['api.qiniu.com', 'rs.qiniuapi.com', 'rsf.qiniuapi.com', 'up.qiniup.com'].includes(request.host))).toBe(false);
  }));

  it('fails the Region query closed without writing a reservation or any asset', async () => withCloud(async ({ plan, server, client, checkpoint }) => {
    server.controls.queryStatus = 503;
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow('HTTP_503');
    expect(server.requests).toEqual([{ method: 'GET', host: 'uc.qiniuapi.com', path: '/v4/query', protocol: 'https:', redirect: 'error' }]);
    expect(server.puts).toHaveLength(0); expect(server.objects.size).toBe(0);
  }));

  it.each([
    ['upDomain', 'attacker.invalid', 'INVALID_UPLOAD_HOST'],
    ['rsDomain', 'attacker.invalid', 'INVALID_MANAGEMENT_HOST'],
    ['rsfDomain', 'attacker.invalid', 'INVALID_MANAGEMENT_HOST'],
    ['upDomain', 'up-z2.qiniup.com.attacker.invalid', 'INVALID_UPLOAD_HOST'],
    ['rsDomain', 'rs-z2.qiniuapi.com.attacker.invalid', 'INVALID_MANAGEMENT_HOST'],
    ['rsfDomain', 'rsf-z2.qiniuapi.com.attacker.invalid', 'INVALID_MANAGEMENT_HOST'],
    ['upDomain', 'http://up-z2.qiniup.com', 'INVALID_UPLOAD_HOST'],
    ['rsDomain', 'http://rs-z2.qiniuapi.com', 'INVALID_MANAGEMENT_HOST'],
    ['rsfDomain', 'http://rsf-z2.qiniuapi.com', 'INVALID_MANAGEMENT_HOST'],
    ['upDomain', 'https://up-z2.qiniup.com', 'INVALID_UPLOAD_HOST'],
    ['rsDomain', 'https://rs-z2.qiniuapi.com', 'INVALID_MANAGEMENT_HOST'],
    ['rsfDomain', 'https://rsf-z2.qiniuapi.com', 'INVALID_MANAGEMENT_HOST'],
  ] as const)('rejects %s endpoint %s without any remote write or HTTP downgrade', async (service, domain, code) => withCloud(async ({ plan, server, client, checkpoint }) => {
    server.controls[service] = domain;
    await expect(uploadQiniuCandidate(plan, client, { checkpoint })).rejects.toThrow(code);
    expect(server.requests).toEqual([{ method: 'GET', host: 'uc.qiniuapi.com', path: '/v4/query', protocol: 'https:', redirect: 'error' }]);
    expect(server.puts).toHaveLength(0); expect(server.objects.size).toBe(0);
  }));
});

it('writes an atomic sanitized local receipt and rejects traversal IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runner-upload-journal-'));
  try {
    const report: UploadCheckpoint = { schemaVersion: 1, buildId: 'synthetic-build', manifestSha256: 'a'.repeat(64), environment: 'preview', bucket: 'synthetic-bucket', prefix: 'runner/releases/synthetic-build/', candidateURL: 'https://example.invalid/runner/releases/synthetic-build/', transport: 'synthetic', mode: 'new', status: 'RESUME_REQUIRED', phase: 'upload', uploaded: [], reused: [], intent: 'runner/upload-intents/synthetic-build.json', failedPath: 'assets/app.js', errorCode: 'HTTP_503' };
    await writeUploadCheckpoint(report, root);
    expect(JSON.parse(await readFile(join(root, 'synthetic-build.json'), 'utf8'))).toEqual(report);
    await expect(writeUploadCheckpoint({ ...report, buildId: '../escape' }, root)).rejects.toThrow('INVALID_CHECKPOINT_ID');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('allows preview candidates only while preserving the independent protected production promotion workflow', async () => {
  const upload = await readFile('.github/workflows/deploy-qiniu.yml', 'utf8');
  const candidate = upload.split('\n  candidate:\n')[1]; if (!candidate) throw new Error('No candidate job');
  expect(upload).toContain('options: [preview]');
  expect(upload).not.toContain('options: [preview, production]');
  expect(candidate).toMatch(/environment:\s*\$\{\{\s*inputs\.environment\s*\}\}/);
  expect(candidate).toMatch(/RELEASE_ENV:\s*\$\{\{\s*inputs\.environment\s*\}\}/);
  expect(candidate).not.toContain('environment: preview');
  expect(candidate).not.toContain('qiniu.mjs promote');
  expect(candidate).toContain('if: always()'); expect(candidate).toContain('immutable-upload-receipt');
  const promote = await readFile('.github/workflows/promote-qiniu.yml', 'utf8');
  expect(promote).toContain('environment: production'); expect(promote).toContain('qiniu.mjs promote --execute');
  expect(promote).toContain("r.environment!=='production'");
});
