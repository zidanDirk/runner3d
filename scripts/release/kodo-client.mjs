import { createHash, createHmac } from 'node:crypto';

export const urlsafe = bytes => Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const md5 = bytes => createHash('md5').update(bytes).digest('hex');
export function kodoEtag(bytes) {
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) blocks.push(createHash('sha1').update(bytes.subarray(offset, offset + 4 * 1024 * 1024)).digest());
  if (!blocks.length) blocks.push(createHash('sha1').update(Buffer.alloc(0)).digest());
  return urlsafe(Buffer.concat([Buffer.from([blocks.length === 1 ? 0x16 : 0x96]), blocks.length === 1 ? blocks[0] : createHash('sha1').update(Buffer.concat(blocks)).digest()]));
}
export function uploadToken(accessKey, secretKey, policy) {
  const encoded = urlsafe(JSON.stringify(policy));
  return `${accessKey}:${urlsafe(createHmac('sha1', secretKey).update(encoded).digest())}:${encoded}`;
}
export function managementAuthorization(accessKey, secretKey, url, date) {
  const target = new URL(url);
  const canonical = `GET ${target.pathname}${target.search}\nHost: ${target.host}\nContent-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: ${date}\n\n`;
  return `Qiniu ${accessKey}:${urlsafe(createHmac('sha1', secretKey).update(canonical).digest())}`;
}
export class KodoError extends Error {
  constructor(code) { super(`Kodo ${code}`); this.name = 'KodoError'; this.code = code; }
}

/** Native HTTPS only. Injectable transport is for synthetic protocol tests. */
export function createKodoClient({ accessKey, secretKey, bucket }, { fetcher = fetch, now = () => new Date(), timeoutMs = 30000 } = {}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new KodoError('TLS_DISABLED');
  if (![accessKey, secretKey].every(s => typeof s === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(s)) || !/^[A-Za-z0-9._-]{1,100}$/.test(bucket)) throw new KodoError('INVALID_CREDENTIAL_CONFIG');
  const overall = AbortSignal.timeout(8 * 60 * 1000);
  const request = async (url, options = {}, missing = false) => {
    let response;
    try { response = await fetcher(url, { ...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([overall, AbortSignal.timeout(timeoutMs)]) }); }
    catch { throw new KodoError('NETWORK_OR_TIMEOUT'); }
    if (missing && response.status === 612) { await response.body?.cancel(); return null; }
    if (response.status !== 200) { await response.body?.cancel(); throw new KodoError(`HTTP_${response.status}`); }
    const chunks = []; let size = 0;
    if (!response.body) throw new KodoError('INVALID_RESPONSE');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 256 * 1024) throw new KodoError('RESPONSE_TOO_LARGE'); chunks.push(value);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new KodoError('INVALID_RESPONSE'); }
    } catch (error) { await reader.cancel().catch(() => {}); if (error instanceof KodoError) throw error; throw new KodoError('NETWORK_OR_TIMEOUT'); }
    finally { reader.releaseLock(); }
  };
  const signedGet = (url, missing = false) => {
    const date = now().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
    return request(url, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Qiniu-Date': date, Authorization: managementAuthorization(accessKey, secretKey, url, date) } }, missing);
  };
  let endpoints;
  const discover = async () => {
    if (!endpoints) endpoints = (async () => {
      const query = new URLSearchParams({ ak: accessKey, bucket });
      const value = await request(`https://uc.qiniuapi.com/v4/query?${query}`), region = value?.hosts?.[0];
      const select = (service, pattern, code) => {
        const domains = region?.[service]?.domains;
        if (!Array.isArray(domains) || !domains.length || !domains.every(d => typeof d === 'string' && pattern.test(d))) throw new KodoError(code);
        return `https://${domains[0]}`;
      };
      return {
        up: select('up', /^(?:up|upload)(?:-[a-z0-9]+)*\.(?:qiniup\.com|qbox\.me)$/, 'INVALID_UPLOAD_HOST'),
        rs: select('rs', /^rs(?:-[a-z0-9]+)*\.(?:qiniuapi\.com|qiniu\.com)$/, 'INVALID_MANAGEMENT_HOST'),
        rsf: select('rsf', /^rsf(?:-[a-z0-9]+)*\.(?:qiniuapi\.com|qiniu\.com)$/, 'INVALID_MANAGEMENT_HOST'),
      };
    })();
    return endpoints;
  };
  return {
    transport: fetcher === fetch ? 'native-fetch-tls' : 'injected-test-transport',
    async stat(key) {
      const { rs } = await discover();
      const value = await signedGet(`${rs}/stat/${urlsafe(`${bucket}:${key}`)}`, true);
      if (value === null) return null;
      if (!value || !Number.isSafeInteger(value.fsize) || value.fsize <= 0 || typeof value.hash !== 'string' || typeof value.mimeType !== 'string' || value.status === 1) throw new KodoError('INVALID_STAT');
      return value;
    },
    async list(prefix, marker = '') {
      const { rsf } = await discover();
      const query = new URLSearchParams({ bucket, prefix, limit: '1000', ...(marker ? { marker } : {}) });
      const value = await signedGet(`${rsf}/list?${query}`);
      if (!value || !Array.isArray(value.items) || value.items.length > 1000 || value.items.some(item => !item || typeof item.key !== 'string' || !item.key.startsWith(prefix)) || (value.marker !== undefined && typeof value.marker !== 'string') || (value.commonPrefixes?.length ?? 0) !== 0) throw new KodoError('INVALID_LIST');
      return { items: value.items, marker: value.marker ?? '' };
    },
    async put(file) {
      const { up } = await discover();
      // mimeLimit performs server-side content sniffing; it does NOT set MIME.
      // Keep the actual multipart MIME and verify it through stat instead.
      const policy = { scope: `${bucket}:${file.key}`, insertOnly: 1, deadline: Math.floor(now().getTime() / 1000) + 600, fsizeLimit: file.bytes.length, detectMime: 0 };
      const form = new FormData();
      form.set('key', file.key); form.set('token', uploadToken(accessKey, secretKey, policy));
      form.set('cacheControl', file.cacheControl);
      form.set('file', new Blob([file.bytes], { type: file.mimeType }), file.key.split('/').at(-1));
      const value = await request(`${up}/`, { method: 'POST', body: form });
      if (value.key !== file.key || value.hash !== file.etag) throw new KodoError('UPLOAD_IDENTITY_MISMATCH');
    },
  };
}
