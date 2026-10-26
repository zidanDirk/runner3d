export const NO_STORE: string;
export const IMMUTABLE: string;
export interface FilePolicy { readonly mimeType: string; readonly cacheControl: string; }
export function releaseFilePolicy(path: string): FilePolicy;
export function sameCacheControl(actual: unknown, expected: string): boolean;
