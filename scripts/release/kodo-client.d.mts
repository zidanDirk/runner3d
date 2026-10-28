export function urlsafe(bytes: string | Uint8Array): string;
export function sha256(bytes: Uint8Array): string;
export function md5(bytes: Uint8Array): string;
export function kodoEtag(bytes: Uint8Array): string;
export function uploadToken(accessKey: string, secretKey: string, policy: Record<string, unknown>): string;
export function managementAuthorization(accessKey: string, secretKey: string, url: string, date: string): string;
export class KodoError extends Error { readonly code: string; readonly regionFailure?: import('./kodo-endpoints.mjs').RegionEndpointFailure; constructor(code: string, regionFailure?: import('./kodo-endpoints.mjs').RegionEndpointFailure); }
export interface KodoFile { key: string; bytes: Uint8Array; mimeType: string; cacheControl: string; etag: string; md5: string; sha256: string; }
export interface KodoStat { fsize: number; hash: string; mimeType: string; md5?: string; cacheControl?: string; status?: number; }
export interface KodoClient { transport: string; stat(key: string): Promise<KodoStat | null>; list(prefix: string, marker?: string): Promise<{ items: { key: string }[]; marker: string }>; put(file: KodoFile): Promise<void>; }
export function createKodoClient(credentials: { accessKey: string; secretKey: string; bucket: string }, options?: { fetcher?: typeof fetch; now?: () => Date; timeoutMs?: number }): KodoClient;
