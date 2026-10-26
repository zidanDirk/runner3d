import type { KodoFile, KodoClient } from './kodo-client.mjs';
import type { ReleaseInfo } from '../../src/release/config';
export interface UploadPlan { readonly buildId: string; readonly manifestSha256: string; readonly environment: string; readonly bucket: string; readonly prefix: string; readonly candidateURL: string; readonly files: readonly (KodoFile & { path: string })[]; readonly intent: KodoFile & { path: string }; }
export interface UploadCheckpoint { schemaVersion: number; buildId: string; manifestSha256: string; environment: string; bucket: string; prefix: string; candidateURL: string; transport: string; mode: string; status: string; phase: string; uploaded: string[]; reused: string[]; intent: string; failedPath: string | null; errorCode: string | null; }
export function prepareQiniuUpload(options: { directory?: string; baseURL: string; bucket: string; report?: { release: ReleaseInfo; manifestSha256: string } }): Promise<UploadPlan>;
export function uploadQiniuCandidate(plan: UploadPlan, client: KodoClient, options?: { resume?: boolean; checkpoint?: (report: UploadCheckpoint) => Promise<void> }): Promise<UploadCheckpoint>;
export function writeUploadCheckpoint(report: UploadCheckpoint, directory?: string): Promise<void>;
