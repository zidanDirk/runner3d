export const READONLY_BUCKET: 'supergames';
export const READONLY_EXISTING_KEY: 'runner/models/generated/city-runner.glb';
export interface ReadonlyRequest { method: 'GET'; host: string; path: string; status: number | null; }
export interface ReadonlyEndpoints { up: string[]; rs: string[]; rsf: string[]; }
export interface ReadonlyReport {
  schemaVersion: 1;
  testedAt: string;
  status: 'PASS' | 'FAIL';
  scope: 'real-api' | 'synthetic-test';
  bucket: string;
  writesExecuted: false;
  requestCount: number;
  requests: ReadonlyRequest[];
  region: { status: 'PASS' | 'FAIL' | 'NOT_RUN'; endpoints?: ReadonlyEndpoints };
  existingObject: { status: 'PASS' | 'FAIL' | 'NOT_RUN'; key: string; bytes?: number; mimeType?: string; hash?: string; md5?: string; cacheControl?: string; cacheControlRedacted?: boolean };
  missingObject: { status: 'PASS' | 'FAIL' | 'NOT_RUN'; key: string; httpStatus?: number | null; mappedToNull?: boolean };
  errorCode?: string;
  sensitiveValuesRedacted?: boolean;
}
export function createReadonlyTransport(options: { accessKey: string; missingKey: string; fetcher?: typeof fetch; timeoutMs?: number }): {
  fetcher: typeof fetch;
  observation: { requests: ReadonlyRequest[]; endpoints: ReadonlyEndpoints | null; errorCode: string | null };
};
export function verifyQiniuReadonly(options?: { accessKey?: string; secretKey?: string; fetcher?: typeof fetch; timeoutMs?: number; now?: () => Date }): Promise<ReadonlyReport>;
