export const HOME_BUCKET: 'supergames';
export const HOME_KEY: 'runner/index.html';
export const HOME_HASH: 'Fsydo-Rs3kzKg93e_csZgcGEPOmk';
export const HOME_CONFIRMATION: string;
export interface HomeStat { hash: string; fsize: number; mimeType: string; cacheControl: string }
export interface HomeCacheReport {
  schemaVersion: number; mode: 'dry-run' | 'execute'; scope: 'real-api' | 'synthetic-test';
  bucket: string; key: string; targetCacheControl: 'no-store'; status: 'PASS' | 'FAIL';
  outcome: 'NOT_ATTEMPTED' | 'UNCHANGED' | 'UPDATED' | 'CONDITION_FAILED' | 'UNKNOWN';
  writesAttempted: number; writesAcknowledged: number; cdnRefreshExecuted: false;
  requests: { method: string; host: string; path: string; status: number | null }[];
  before: HomeStat | null; after: HomeStat | null; errorCode?: string; checkedAt: string;
}
export function maintainHomeCache(options?: { accessKey?: string; secretKey?: string; execute?: boolean; confirmation?: string; fetcher?: typeof fetch; timeoutMs?: number; now?: () => Date }): Promise<HomeCacheReport>;
