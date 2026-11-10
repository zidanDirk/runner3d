import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createKodoClient, KodoError, urlsafe } from './kodo-client.mjs';
import { isAllowedServiceHost } from './kodo-endpoints.mjs';
import { sameCacheControl } from './cache-policy.mjs';

export const HOME_BUCKET = 'supergames';
export const HOME_KEY = 'runner/index.html';
export const HOME_HASH = 'Fsydo-Rs3kzKg93e_csZgcGEPOmk';
export const HOME_CONFIRMATION = `SET NO-STORE ${HOME_BUCKET}:${HOME_KEY} ${HOME_HASH}`;
const fail = code => { throw new KodoError(code); };

function snapshot(stat) {
  if (!stat) fail('HOME_OBJECT_MISSING');
  if (stat.hash !== HOME_HASH || !Number.isSafeInteger(stat.fsize) || stat.fsize <= 0 || stat.mimeType !== 'text/html') fail('HOME_IDENTITY_MISMATCH');
  if (typeof stat.cacheControl !== 'string') fail('OBJECT_CACHE_CONTROL_MISSING');
  if (/[\r\n]/.test(stat.cacheControl)) fail('UNEXPECTED_CACHE_CONTROL');
  if (!sameCacheControl(stat.cacheControl, 'public, max-age=31536000') && !sameCacheControl(stat.cacheControl, 'no-store')) fail('UNEXPECTED_CACHE_CONTROL');
  // No raw stat, arbitrary metadata, response headers or credential-bearing URL.
  return { hash: stat.hash, fsize: stat.fsize, mimeType: stat.mimeType, cacheControl: stat.cacheControl };
}

/** Fixed one-object operation. Injection is only for local synthetic protocol tests. */
export async function maintainHomeCache({ accessKey, secretKey, execute = false, confirmation = '', fetcher = fetch, timeoutMs = 15000, now = () => new Date() } = {}) {
  const report = { schemaVersion: 1, mode: execute ? 'execute' : 'dry-run', scope: fetcher === fetch ? 'real-api' : 'synthetic-test', bucket: HOME_BUCKET, key: HOME_KEY,
    targetCacheControl: 'no-store', status: 'FAIL', outcome: 'NOT_ATTEMPTED', writesAttempted: 0, writesAcknowledged: 0, requests: [], before: null, after: null, cdnRefreshExecuted: false };
  let armedPath = null, rsOrigin = null, queries = 0, stats = 0;
  try {
    if (typeof execute !== 'boolean' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('INVALID_OPTIONS');
    if (execute && confirmation !== HOME_CONFIRMATION) fail('EXPLICIT_CONFIRMATION_REQUIRED');
    const statPath = `/stat/${urlsafe(`${HOME_BUCKET}:${HOME_KEY}`)}`;
    // Defense in depth: the existing client can upload/list, this operation cannot.
    const guardedFetch = async (input, init = {}) => {
      const url = new URL(input), method = init.method ?? 'GET';
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || init.redirect !== 'error') fail('UNSAFE_TRANSPORT');
      const region = method === 'GET' && url.origin === 'https://uc.qiniuapi.com' && url.pathname === '/v4/query';
      if (region) {
        if (++queries > 1 || JSON.stringify([...url.searchParams.keys()].sort()) !== '["ak","bucket"]' || url.searchParams.get('ak') !== accessKey || url.searchParams.get('bucket') !== HOME_BUCKET) fail('UNSAFE_REGION_REQUEST');
      } else {
        if (!isAllowedServiceHost('rs', url.hostname) || url.search) fail('UNSAFE_OBJECT_REQUEST');
        if (method === 'GET' && url.pathname === statPath) {
          if (++stats > 2 || (rsOrigin && rsOrigin !== url.origin)) fail('REQUEST_LIMIT');
          rsOrigin = url.origin;
        } else if (method === 'POST' && execute && armedPath && url.origin === rsOrigin && url.pathname === armedPath && init.body === '' && report.writesAttempted === 0) {
          report.writesAttempted++; report.outcome = 'UNKNOWN';
        } else fail('WRITE_SCOPE_BLOCKED');
      }
      const item = { method, host: url.hostname, path: region ? '/v4/query' : method === 'GET' ? '/stat/<fixed-entry>' : '/chgm/<fixed-entry>/cacheControl/<no-store>/cond/<original-identity>', status: null };
      report.requests.push(item);
      const response = await fetcher(input, init); item.status = response.status;
      return response;
    };
    const client = createKodoClient({ accessKey, secretKey, bucket: HOME_BUCKET }, { fetcher: guardedFetch, timeoutMs, now });
    const before = snapshot(await client.stat(HOME_KEY)); report.before = before;
    if (sameCacheControl(before.cacheControl, 'no-store')) { report.outcome = 'UNCHANGED'; report.after = before; }
    else if (execute) {
      const condition = `hash=${before.hash}&fsize=${before.fsize}&mime=${before.mimeType}`;
      armedPath = `/chgm/${urlsafe(`${HOME_BUCKET}:${HOME_KEY}`)}/cacheControl/${urlsafe('no-store')}/cond/${urlsafe(condition)}`;
      await client.setNoStoreIfUnchanged(HOME_KEY, before);
      report.writesAcknowledged = 1;
      const after = snapshot(await client.stat(HOME_KEY)); report.after = after;
      if (after.hash !== before.hash || after.fsize !== before.fsize || after.mimeType !== before.mimeType || !sameCacheControl(after.cacheControl, 'no-store')) fail('POSTCHECK_MISMATCH');
      report.outcome = 'UPDATED';
    }
    report.status = 'PASS';
  } catch (error) {
    report.errorCode = error instanceof KodoError && /^[A-Z_0-9]{1,80}$/.test(error.code) ? error.code : 'UNEXPECTED_FAILURE';
    if (report.errorCode === 'HTTP_613') report.outcome = 'CONDITION_FAILED';
    // An attempted POST with a lost response/failed readback is UNKNOWN, never retried.
  }
  report.checkedAt = now().toISOString();
  // Only known fields are reported; also scrub accidental credential reflection.
  const secrets = [accessKey, secretKey].filter(value => typeof value === 'string' && value.length >= 6);
  return JSON.parse(JSON.stringify(report, (_key, value) => typeof value === 'string' ? secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value) : value));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  let report;
  if (args.length > 1 || (args.length && !['--dry-run', '--execute'].includes(args[0]))) {
    report = { status: 'FAIL', errorCode: 'INVALID_ARGUMENTS', writesAttempted: 0, writesAcknowledged: 0, outcome: 'NOT_ATTEMPTED' };
  } else {
    report = await maintainHomeCache({ accessKey: process.env.QINIU_AK, secretKey: process.env.QINIU_SK, execute: args[0] === '--execute', confirmation: process.env.QINIU_HOME_CACHE_CONFIRM ?? '' });
  }
  try {
    await mkdir('artifacts/qiniu-home-cache', { recursive: true });
    await writeFile('artifacts/qiniu-home-cache/report.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch { console.error('[qiniu-home-cache] REPORT_WRITE_FAILED; preserve runner logs, do not retry a write'); process.exitCode = 1; }
  if (report.status !== 'PASS') process.exitCode = 1;
}
