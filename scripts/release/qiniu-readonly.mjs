import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createKodoClient, KodoError, urlsafe } from './kodo-client.mjs';
import { parseRegionEndpoints, isAllowedServiceHost, RegionEndpointError } from './kodo-endpoints.mjs';

export const READONLY_BUCKET = 'supergames';
export const READONLY_EXISTING_KEY = 'runner/models/generated/city-runner.glb';
const fail = code => { throw new KodoError(code); };
const abortable = async (promise, signal) => {
  let onAbort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      onAbort = () => reject(new KodoError('NETWORK_OR_TIMEOUT'));
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
};
async function boundedBytes(response, signal) {
  if (!response.body) fail('INVALID_RESPONSE');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal); if (done) break;
      length += value.byteLength; if (length > 256 * 1024) fail('RESPONSE_TOO_LARGE'); chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

/** No URL rewriting: only two exact stat paths and the official Region query. */
export function createReadonlyTransport({ accessKey, missingKey, fetcher = fetch, timeoutMs = 15000 }) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('TLS_DISABLED');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('INVALID_TIMEOUT');
  if (!/^runner\/__readonly_verification__\/missing-[a-f0-9-]{36}\.glb$/.test(missingKey)) fail('INVALID_MISSING_KEY');
  const paths = new Set([READONLY_EXISTING_KEY, missingKey].map(key => `/stat/${urlsafe(`${READONLY_BUCKET}:${key}`)}`));
  const observation = { requests: [], endpoints: null, errorCode: null, regionFailure: null };
  const overall = AbortSignal.timeout(60000);
  const guardedFetch = async (input, init = {}) => {
    try {
      if ((init.method ?? (input instanceof Request ? input.method : 'GET')) !== 'GET') fail('WRITE_METHOD_BLOCKED');
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || init.redirect !== 'error') fail('UNSAFE_TRANSPORT');
      const region = url.hostname === 'uc.qiniuapi.com' && url.pathname === '/v4/query';
      if (region) {
        if (JSON.stringify([...url.searchParams.keys()].sort()) !== '["ak","bucket"]' || url.searchParams.get('ak') !== accessKey || url.searchParams.get('bucket') !== READONLY_BUCKET) fail('UNSAFE_REGION_QUERY');
      } else if (!isAllowedServiceHost('rs', url.hostname) || !paths.has(url.pathname) || url.search || !observation.endpoints?.rs.includes(url.origin)) fail('UNSAFE_READ_PATH');
      if (observation.requests.length >= 3) fail('REQUEST_LIMIT');
      const signal = AbortSignal.any([overall, AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]);
      const item = { method: 'GET', host: url.hostname, path: region ? '/v4/query' : '/stat/<entry-redacted>', status: null };
      observation.requests.push(item);
      const response = await abortable(fetcher(input, { ...init, method: 'GET', redirect: 'error', signal }), signal);
      item.status = response.status;
      // Buffer successful bodies once with bounds, then let the original client
      // parse the exact same bytes. 612 is returned untouched (not a fake 404).
      if (response.status !== 200) return response;
      const bytes = await boundedBytes(response, signal);
      if (region) {
        let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_REGION_JSON'); }
        observation.endpoints = parseRegionEndpoints(value);
      }
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (error instanceof RegionEndpointError) observation.regionFailure = error.failure;
      observation.errorCode = error instanceof KodoError && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'NETWORK_OR_TIMEOUT';
      if (observation.regionFailure) observation.errorCode = 'INVALID_REGION_ENDPOINT';
      throw new KodoError(observation.errorCode, observation.regionFailure ?? undefined);
    }
  };
  return { fetcher: guardedFetch, observation };
}

const validHash = hash => typeof hash === 'string' && /^[A-Za-z0-9_-]{28}$/.test(hash) && Buffer.from(hash, 'base64url').length === 21 && [0x16, 0x96].includes(Buffer.from(hash, 'base64url')[0]);
const cacheDirective = '(?:public|private|no-cache|no-store|immutable|must-revalidate|proxy-revalidate|no-transform|(?:s-maxage|max-age|stale-while-revalidate|stale-if-error)=\\d+)';
const safeCache = new RegExp(`^${cacheDirective}(?:\\s*,\\s*${cacheDirective})*$`, 'i');
function statSummary(stat) {
  if (!stat) fail('EXISTING_OBJECT_MISSING');
  if (!Number.isSafeInteger(stat.fsize) || stat.fsize <= 0 || stat.mimeType.toLowerCase().trim() !== 'model/gltf-binary' || !validHash(stat.hash)) fail('INVALID_GLB_STAT');
  const summary = { bytes: stat.fsize, mimeType: stat.mimeType, hash: stat.hash };
  if (Object.hasOwn(stat, 'md5')) {
    if (typeof stat.md5 !== 'string' || !/^[a-f0-9]{32}$/i.test(stat.md5)) fail('INVALID_STAT_MD5');
    summary.md5 = stat.md5;
  }
  if (Object.hasOwn(stat, 'cacheControl')) {
    if (typeof stat.cacheControl !== 'string' || stat.cacheControl.length > 1024 || /[\r\n]/.test(stat.cacheControl)) fail('INVALID_STAT_CACHE_CONTROL');
    // Reporting filter, not the new immutable-cache policy. Old long caching
    // is valid here; unexpected free text is not printed as a secret channel.
    if (safeCache.test(stat.cacheControl.trim())) summary.cacheControl = stat.cacheControl;
    else summary.cacheControlRedacted = true;
  }
  return summary;
}
function redact(report, accessKey, secretKey) {
  let changed = false;
  const walk = value => {
    if (typeof value === 'string') {
      for (const key of [accessKey, secretKey]) if (typeof key === 'string' && key && value.includes(key)) { value = value.replaceAll(key, '[REDACTED]'); changed = true; }
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  const result = walk(report);
  if (changed) result.sensitiveValuesRedacted = true;
  return result;
}

/** Unit injection is explicitly synthetic; CLI always uses native HTTPS. */
export async function verifyQiniuReadonly({ accessKey, secretKey, fetcher = fetch, timeoutMs = 15000, now = () => new Date() } = {}) {
  const missingKey = `runner/__readonly_verification__/missing-${randomUUID()}.glb`;
  const report = { schemaVersion: 1, testedAt: now().toISOString(), status: 'FAIL', scope: fetcher === fetch ? 'real-api' : 'synthetic-test', bucket: READONLY_BUCKET, writesExecuted: false, requestCount: 0, requests: [], region: { status: 'NOT_RUN' }, existingObject: { status: 'NOT_RUN', key: READONLY_EXISTING_KEY }, missingObject: { status: 'NOT_RUN', key: missingKey } };
  let transport;
  try {
    transport = createReadonlyTransport({ accessKey, missingKey, fetcher, timeoutMs });
    const client = createKodoClient({ accessKey, secretKey, bucket: READONLY_BUCKET }, { fetcher: transport.fetcher, now, timeoutMs });
    report.region.status = 'FAIL';
    const stat = await client.stat(READONLY_EXISTING_KEY);
    report.region = { status: 'PASS', endpoints: transport.observation.endpoints };
    report.existingObject.status = 'FAIL';
    Object.assign(report.existingObject, statSummary(stat), { status: 'PASS' });
    report.missingObject.status = 'FAIL';
    const missing = await client.stat(missingKey), status = transport.observation.requests.at(-1)?.status;
    report.missingObject.httpStatus = status;
    report.missingObject.mappedToNull = missing === null;
    if (missing !== null || status !== 612) fail('MISSING_OBJECT_NOT_612_NULL');
    report.missingObject.status = 'PASS'; report.status = 'PASS';
  } catch (error) {
    if (transport?.observation.endpoints) report.region = { status: 'PASS', endpoints: transport.observation.endpoints };
    if (transport?.observation.regionFailure) report.region = { status: 'FAIL', failure: transport.observation.regionFailure };
    if (report.existingObject.status === 'NOT_RUN' && (transport?.observation.requests.length ?? 0) >= 2) report.existingObject.status = 'FAIL';
    if (report.missingObject.status === 'FAIL') report.missingObject.httpStatus = transport?.observation.requests.at(-1)?.status ?? null;
    report.errorCode = transport?.observation.errorCode ?? (error instanceof KodoError && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'VERIFICATION_FAILED');
  }
  if (transport) { report.requests = transport.observation.requests; report.requestCount = report.requests.length; }
  return redact(report, accessKey, secretKey);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const path = 'artifacts/qiniu-readonly/report.json';
  try {
    const report = await verifyQiniuReadonly(process.argv.length === 2 ? { accessKey: process.env.QINIU_AK, secretKey: process.env.QINIU_SK } : {});
    if (process.argv.length !== 2) report.errorCode = 'UNEXPECTED_ARGUMENTS';
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(`Qiniu readonly: ${report.status}; requests=${report.requestCount}; writes=false`);
    if (report.status !== 'PASS') process.exitCode = 1;
  } catch { console.error('Qiniu readonly: FAIL; REPORT_IO_FAILURE'); process.exitCode = 1; }
}
