import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { releaseFilePolicy, sameCacheControl } from './cache-policy.mjs';
import { sha256, md5, kodoEtag, KodoError } from './kodo-client.mjs';
import { verifyRelease } from './verify.mjs';

const makeFile = (path, key, bytes) => Object.freeze({ path, key, bytes, ...releaseFilePolicy(path), sha256: sha256(bytes), md5: md5(bytes), etag: kodoEtag(bytes) });

/** Snapshot exact gated bytes before any cloud request. No build ID rewriting. */
export async function prepareQiniuUpload({ directory = 'dist', baseURL, bucket, report }) {
  const base = new URL(baseURL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base.pathname) || !/^[A-Za-z0-9._-]{1,100}$/.test(bucket)) throw new KodoError('INVALID_DESTINATION');
  const verified = report ?? await verifyRelease(directory);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(verified.release.buildId) || !['preview', 'production'].includes(verified.release.environment)) throw new KodoError('INVALID_RELEASE_IDENTITY');
  const bytes = await readFile(resolve(directory, 'release-manifest.json'));
  if (sha256(bytes) !== verified.manifestSha256) throw new KodoError('LOCAL_MANIFEST_MISMATCH');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(manifest.release) !== JSON.stringify(verified.release) || Object.keys(manifest.files).length > 256) throw new KodoError('LOCAL_MANIFEST_MISMATCH');
  const id = verified.release.buildId, rootPrefix = base.pathname.slice(1), prefix = `${rootPrefix}releases/${id}/`;
  const files = []; let total = 0;
  for (const [path, entry] of Object.entries(manifest.files)) {
    releaseFilePolicy(path); // Reject unknown types before even asking Kodo if the ID exists.
    const contents = await readFile(resolve(directory, path));
    total += contents.length;
    if (contents.length !== entry.bytes || sha256(contents) !== entry.sha256 || contents.length > 8 * 1024 * 1024 || total > 64 * 1024 * 1024) throw new KodoError('LOCAL_CONTENT_MISMATCH');
    files.push(makeFile(path, `${prefix}${path}`, contents));
  }
  if (bytes.length > 256 * 1024) throw new KodoError('LOCAL_MANIFEST_MISMATCH');
  files.push(makeFile('release-manifest.json', `${prefix}release-manifest.json`, bytes));
  const rank = path => path === 'index.html' ? 2 : path === 'release-manifest.json' ? 1 : 0;
  files.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path, 'en'));
  const planSha256 = sha256(Buffer.from(JSON.stringify(files.map(file => ({ path: file.path, sha256: file.sha256, mimeType: file.mimeType, cacheControl: file.cacheControl })))));
  const intentBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, buildId: id, manifestSha256: verified.manifestSha256, planSha256, environment: verified.release.environment, bucket, prefix, fileCount: files.length, cachePolicyVersion: 1 }) + '\n');
  const intent = makeFile('upload-intent.json', `${rootPrefix}upload-intents/${id}.json`, intentBytes);
  return Object.freeze({ buildId: id, manifestSha256: verified.manifestSha256, environment: verified.release.environment, bucket, prefix, candidateURL: new URL(`releases/${id}/`, base).href, files: Object.freeze(files), intent });
}

function matches(stat, file) {
  if (!stat || stat.fsize !== file.bytes.length || stat.hash !== file.etag || stat.md5 !== file.md5) throw new KodoError('CONTENT_MISMATCH');
  if (stat.mimeType.toLowerCase().trim() !== file.mimeType || !sameCacheControl(stat.cacheControl, file.cacheControl)) throw new KodoError('METADATA_MISMATCH');
}

async function inventory(client, prefix, limit) {
  const result = [], seen = new Set(), markers = new Set(); let marker = '';
  for (let page = 0; page < 260; page++) {
    const data = await client.list(prefix, marker);
    for (const item of data.items) {
      if (seen.has(item.key) || result.length >= limit) throw new KodoError('INVALID_INVENTORY');
      seen.add(item.key); result.push(item.key);
    }
    if (!data.marker) return result;
    if (data.marker.length > 4096 || markers.has(data.marker)) throw new KodoError('INVALID_INVENTORY');
    markers.add(data.marker);
    marker = data.marker;
  }
  throw new KodoError('INVENTORY_LIMIT');
}

/** New-only writes, exact-artifact resume, metadata readback, index.html last. */
export async function uploadQiniuCandidate(plan, client, { resume = false, checkpoint = async () => {} } = {}) {
  for (const file of [...plan.files, plan.intent]) if (sha256(file.bytes) !== file.sha256) throw new KodoError('LOCAL_CONTENT_MISMATCH');
  const result = { schemaVersion: 1, buildId: plan.buildId, manifestSha256: plan.manifestSha256, environment: plan.environment, bucket: plan.bucket, prefix: plan.prefix, candidateURL: plan.candidateURL, transport: client.transport, mode: resume ? 'resume' : 'new', status: 'CHECKING', phase: 'inventory', uploaded: [], reused: [], intent: plan.intent.key, failedPath: null, errorCode: null };
  const save = () => checkpoint(structuredClone(result));
  try {
    await save();
    const existing = await inventory(client, plan.prefix, 258);
    const intentStat = await client.stat(plan.intent.key);
    if (!resume && (existing.length || intentStat)) throw new KodoError('DUPLICATE_BUILD_ID');
    if (resume) {
      if (!intentStat && existing.length) throw new KodoError('UNTRUSTED_RESUME');
      if (intentStat) matches(intentStat, plan.intent);
    }
    const expected = new Map(plan.files.map(file => [file.key, file]));
    if (existing.some(key => !expected.has(key))) throw new KodoError('UNEXPECTED_REMOTE_OBJECT');
    // Validate ALL existing objects before any new write, not merely while skipping them.
    for (const key of existing) { const file = expected.get(key); matches(await client.stat(key), file); result.reused.push(file.path); }
    result.status = 'UPLOADING'; result.phase = 'reserve'; await save();
    if (!intentStat) {
      await client.put(plan.intent); matches(await client.stat(plan.intent.key), plan.intent);
    }
    const present = new Set(existing);
    for (const file of plan.files) {
      if (present.has(file.key)) continue;
      result.phase = 'upload-with-metadata'; result.failedPath = file.path; await save();
      if (sha256(file.bytes) !== file.sha256) throw new KodoError('LOCAL_CONTENT_MISMATCH');
      await client.put(file);
      result.phase = 'verify-content-and-metadata'; await save();
      matches(await client.stat(file.key), file);
      result.uploaded.push(file.path);
    }
    result.phase = 'final-inventory'; result.failedPath = null; await save();
    const final = await inventory(client, plan.prefix, 258);
    if (final.length !== plan.files.length || final.some(key => !expected.has(key))) throw new KodoError('INVALID_FINAL_INVENTORY');
    for (const file of plan.files) matches(await client.stat(file.key), file);
    result.status = result.uploaded.length ? 'COMPLETE' : 'VERIFIED_EXISTING'; result.phase = 'done'; await save();
    return result;
  } catch (error) {
    const code = error instanceof KodoError ? error.code : 'LOCAL_CHECKPOINT_OR_IO_FAILURE';
    result.errorCode = code;
    if (error instanceof KodoError && error.regionFailure) result.regionFailure = error.regionFailure;
    result.status = /MISMATCH|DUPLICATE|UNTRUSTED|UNEXPECTED|INVALID/.test(code) ? 'BLOCKED' : 'RESUME_REQUIRED';
    try { await save(); } catch { /* Prior checkpoint + Kodo state still identify the immutable attempt. */ }
    throw new KodoError(`${code}; ${result.status}; exact artifact and explicit resume required, never overwrite/delete`, error instanceof KodoError ? error.regionFailure : undefined);
  }
}

/** Durable local receipt only: no credentials, API response bodies or signed URLs. */
export async function writeUploadCheckpoint(report, directory = 'artifacts/beta-release/uploads') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(report.buildId)) throw new KodoError('INVALID_CHECKPOINT_ID');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${report.buildId}.json`), temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
