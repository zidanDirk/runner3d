import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';

export const SYNTHETIC_AK = 'synthetic-access-key';
export const SYNTHETIC_SK = 'synthetic-secret-key';
export interface StoredObject { bytes: Buffer; mimeType: string; cacheControl: string; }
const hash = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest();
const safe64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_');
function objectEtag(bytes: Buffer): string {
  if (bytes.length <= 4194304) return safe64(Buffer.concat([Buffer.from([22]), hash('sha1', bytes)]));
  const parts: Buffer[] = [];
  for (let index = 0; index < bytes.length; index += 4194304) parts.push(hash('sha1', bytes.subarray(index, index + 4194304)));
  return safe64(Buffer.concat([Buffer.from([150]), hash('sha1', Buffer.concat(parts))]));
}

/** Synthetic Kodo protocol over real loopback HTTP, never a Qiniu connection. */
export async function kodoServer() {
  const objects = new Map<string, StoredObject>();
  const requests: { method: string; path: string; host: string; protocol: string; redirect: string }[] = [];
  const puts: string[] = [], policies: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const controls = { rejectUpload: '', rejectMetadata: '', wrongMetadata: '', loseResponse: '', wrongReceipt: '', statFailure: '', pageSize: 1000, repeatedMarker: false, invalidUploadHost: false, reservationConflict: false, regional: false, queryStatus: 200, upDomain: '', rsDomain: '', rsfDomain: '' };
  const server = createServer(async (req, res) => {
    const respond = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(String(req.headers['x-synthetic-original-url']));
      requests.push({ method: req.method ?? 'GET', path: url.pathname, host: url.hostname, protocol: url.protocol, redirect: String(req.headers['x-synthetic-redirect']) });
      if (url.hostname === 'uc.qiniuapi.com' && url.pathname === '/v4/query') {
        if (url.searchParams.get('ak') !== SYNTHETIC_AK || url.searchParams.get('bucket') !== 'synthetic-bucket') throw new Error('Wrong region query');
        if (controls.queryStatus !== 200) { respond(controls.queryStatus, { error: 'Synthetic region query failure' }); return; }
        respond(200, { hosts: [{ region: controls.regional ? 'z2' : 'z0', up: { domains: [controls.upDomain || (controls.invalidUploadHost ? 'attacker.invalid' : controls.regional ? 'up-z2.qiniup.com' : 'up.qiniup.com')] }, rs: { domains: [controls.rsDomain || (controls.regional ? 'rs-z2.qiniuapi.com' : 'rs.qiniuapi.com')] }, rsf: { domains: [controls.rsfDomain || (controls.regional ? 'rsf-z2.qiniuapi.com' : 'rsf.qiniuapi.com')] } }] }); return;
      }
      if (req.method === 'GET') {
        const date = String(req.headers['x-qiniu-date']);
        const canonical = `GET ${url.pathname}${url.search}\nHost: ${url.host}\nContent-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: ${date}\n\n`;
        const signature = safe64(createHmac('sha1', SYNTHETIC_SK).update(canonical).digest());
        if (req.headers.authorization !== `Qiniu ${SYNTHETIC_AK}:${signature}` || !/^\d{8}T\d{6}Z$/.test(date)) throw new Error('Invalid management signature');
        if (url.pathname.startsWith('/stat/')) {
          const entry = Buffer.from(url.pathname.slice(6), 'base64').toString();
          if (!entry.startsWith('synthetic-bucket:')) throw new Error('Wrong stat bucket');
          const key = entry.slice('synthetic-bucket:'.length), file = objects.get(key);
          if (controls.statFailure && key.endsWith(controls.statFailure)) { respond(503, { error: `${SYNTHETIC_AK} ${SYNTHETIC_SK}` }); return; }
          if (!file) { respond(612, { error: 'no such file' }); return; }
          respond(200, { fsize: file.bytes.length, hash: objectEtag(file.bytes), md5: hash('md5', file.bytes).toString('hex'), mimeType: file.mimeType, cacheControl: file.cacheControl }); return;
        }
        if (url.pathname === '/list') {
          if (url.searchParams.get('bucket') !== 'synthetic-bucket') throw new Error('Wrong list bucket');
          const prefix = url.searchParams.get('prefix') ?? '', start = Number(url.searchParams.get('marker') ?? '0');
          const keys = [...objects.keys()].filter(key => key.startsWith(prefix)).sort();
          const items = keys.slice(start, start + controls.pageSize).map(key => ({ key }));
          respond(200, { items, marker: controls.repeatedMarker ? 'repeat' : start + items.length < keys.length ? String(start + items.length) : '' }); return;
        }
      }
      if (req.method !== 'POST' || url.href !== (controls.regional ? 'https://up-z2.qiniup.com/' : 'https://up.qiniup.com/')) throw new Error('Unexpected mutation route');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new Request('http://127.0.0.1/', { method: 'POST', headers: { 'content-type': String(req.headers['content-type']) }, body: new Blob([new Uint8Array(Buffer.concat(chunks))]) });
      const form = await request.formData();
      const key = form.get('key'), token = form.get('token'), cache = form.get('cacheControl'), body = form.get('file');
      if (typeof key !== 'string' || typeof token !== 'string' || typeof cache !== 'string' || !(body instanceof Blob)) throw new Error('Missing real multipart fields');
      const [ak, signature, encoded, extra] = token.split(':');
      if (ak !== SYNTHETIC_AK || !encoded || extra || signature !== safe64(createHmac('sha1', SYNTHETIC_SK).update(encoded).digest())) throw new Error('Invalid upload token');
      const policy: Record<string, unknown> = JSON.parse(Buffer.from(encoded, 'base64').toString());
      policies.push(policy); puts.push(key);
      if (policy.scope !== `synthetic-bucket:${key}` || policy.insertOnly !== 1 || policy.fsizeLimit !== body.size || policy.detectMime !== 0 || Object.hasOwn(policy, 'mimeLimit') || typeof policy.deadline !== 'number' || policy.deadline <= Date.now() / 1000 || policy.deadline > Date.now() / 1000 + 610) throw new Error('Invalid bounded new-only policy');
      if (objects.has(key) || (controls.reservationConflict && key.includes('/upload-intents/'))) { respond(614, { error: 'file exists' }); return; }
      if (controls.rejectUpload && key.endsWith(controls.rejectUpload)) { respond(503, { error: `${SYNTHETIC_AK} ${SYNTHETIC_SK} ${token}` }); return; }
      if (controls.rejectMetadata && key.endsWith(controls.rejectMetadata)) { respond(400, { error: 'cacheControl rejected' }); return; }
      const bytes = Buffer.from(await body.arrayBuffer());
      objects.set(key, { bytes, mimeType: body.type, cacheControl: controls.wrongMetadata && key.endsWith(controls.wrongMetadata) ? 'public,max-age=31536000' : cache });
      if (controls.loseResponse && key.endsWith(controls.loseResponse)) { req.socket.destroy(); return; }
      respond(200, { key: controls.wrongReceipt && key.endsWith(controls.wrongReceipt) ? 'different-key' : key, hash: objectEtag(bytes) });
    } catch (error) { failures.push(error instanceof Error ? error.message : 'protocol fixture failed'); respond(500, { error: 'Synthetic server assertion failed' }); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback test server address');
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: typeof fetch = (input, init) => {
    const original = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
    const headers = new Headers(init?.headers); headers.set('x-synthetic-original-url', original.href); headers.set('x-synthetic-redirect', init?.redirect ?? '');
    return fetch(new URL(original.pathname + original.search, origin), { ...init, headers });
  };
  return { objects, requests, puts, policies, controls, failures, transport, async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
